"""LangChain / LangGraph tool wrapper with Airlock human-approval gate.

The LangChain import is guarded — this module loads fine without
``langchain-core`` installed. Instantiating ``AirlockApprovalTool`` without
it raises ``ImportError`` with a clear install message.

Requires:
    pip install langchain-core>=0.1

Usage in LangGraph::

    from langchain_community.tools.shell import ShellTool
    from integrations.langchain import AirlockClient, AirlockApprovalTool

    client = AirlockClient(api_key="im_...")
    safe_shell = AirlockApprovalTool.wrap(
        ShellTool(),
        client=client,
        kind="shell.exec",
        editable=["preview.body"],
    )

    # Register with a LangGraph ToolNode — the graph blocks at this node
    # until a human approves in the Airlock inbox.
    from langgraph.prebuilt import ToolNode
    tool_node = ToolNode([safe_shell])
"""
from __future__ import annotations

import json
from typing import Any, Optional

from ._client import AirlockClient
from ._errors import AirlockRejected, AirlockTimeout

# Guard the import so the module can be imported in test / non-LangChain
# environments without crashing. Instantiation raises ImportError if absent.
try:
    from langchain_core.callbacks import CallbackManagerForToolRun
    from langchain_core.tools import BaseTool
    _LANGCHAIN_AVAILABLE = True
except ImportError:
    _LANGCHAIN_AVAILABLE = False
    BaseTool = object  # type: ignore[assignment, misc]
    CallbackManagerForToolRun = None  # type: ignore[assignment]


if _LANGCHAIN_AVAILABLE:
    class AirlockApprovalTool(BaseTool):  # type: ignore[misc]
        """LangChain tool that gates any other tool behind Airlock human approval.

        Before the wrapped tool's logic runs, the proposed call is submitted to
        the Airlock inbox as a pending action. Execution blocks (synchronous poll)
        until a reviewer approves or rejects in their inbox. On approval the
        wrapped tool runs and the result is reported back to Airlock. On rejection
        ``AirlockRejected`` propagates to the agent.

        Works transparently as a drop-in inside ``langgraph.prebuilt.ToolNode``
        because LangGraph calls ``tool.run(args)`` exactly as LangChain does.

        Use :meth:`wrap` as the preferred constructor — it copies the wrapped
        tool's ``name``, ``description``, and ``args_schema`` so the LLM sees
        identical tool metadata.

        Attributes:
            airlock_client:        Configured :class:`AirlockClient` instance.
            wrapped_tool:        The tool whose execution is gated.
            airlock_kind:          Action kind label (e.g. ``'shell.exec'``).
            airlock_preview_format: ``'plain'`` | ``'markdown'`` | ``'diff'``.
            airlock_editable:      Dot-path fields the reviewer may edit.
            airlock_timeout_s:     Seconds to poll before raising ``AirlockTimeout``.
            airlock_poll_interval_s: Seconds between GET /v1/actions/:id polls.
            airlock_report_result: If ``True`` (default), calls ``report_result``
                                 after execution to close the audit loop.
        """

        # Allow arbitrary Pydantic types (AirlockClient, BaseTool subclass).
        # langchain-core's BaseTool already sets this; repeat for safety.
        model_config = {"arbitrary_types_allowed": True}

        # Required BaseTool fields — set by wrap() to match the wrapped tool.
        name: str = "airlock_approval"
        description: str = "Submits a proposed tool call for human approval via Airlock."

        # Airlock-specific fields (prefixed to avoid clashing with BaseTool attrs).
        airlock_client: Any  # AirlockClient — typed as Any for Pydantic compatibility
        wrapped_tool: Any  # BaseTool subclass
        airlock_kind: str = "tool.call"
        airlock_preview_format: str = "plain"
        airlock_editable: list = ["preview.body"]  # type: ignore[assignment]
        airlock_timeout_s: float = 300.0
        airlock_poll_interval_s: float = 5.0
        airlock_report_result: bool = True

        @classmethod
        def wrap(
            cls,
            tool: Any,
            *,
            client: AirlockClient,
            kind: str | None = None,
            preview_format: str = "plain",
            editable: list[str] | None = None,
            timeout_s: float = 300.0,
            poll_interval_s: float = 5.0,
            report_result: bool = True,
        ) -> "AirlockApprovalTool":
            """Wrap ``tool`` with an Airlock approval gate.

            The resulting tool shares the wrapped tool's ``name``, ``description``,
            and ``args_schema`` so the LLM calls it with exactly the same arguments.

            Args:
                tool:           Any ``BaseTool`` instance.
                client:         Configured :class:`AirlockClient`.
                kind:           Action kind label; defaults to ``tool.<tool.name>``.
                preview_format: Format for the inbox preview card.
                editable:       Fields the reviewer may edit (default ``['preview.body']``).
                timeout_s:      Poll timeout in seconds.
                poll_interval_s: Poll interval in seconds (minimum 5 recommended).
                report_result:  Whether to call ``report_result`` after execution.
            """
            kwargs: dict[str, Any] = dict(
                name=tool.name,
                description=f"[Airlock approval required] {tool.description}",
                airlock_client=client,
                wrapped_tool=tool,
                airlock_kind=kind or f"tool.{tool.name}",
                airlock_preview_format=preview_format,
                airlock_editable=editable if editable is not None else ["preview.body"],
                airlock_timeout_s=timeout_s,
                airlock_poll_interval_s=poll_interval_s,
                airlock_report_result=report_result,
            )
            # Inherit the wrapped tool's args_schema when available so that
            # LangGraph ToolNode passes structured kwargs to _run correctly.
            schema = getattr(tool, "args_schema", None)
            if schema is not None:
                kwargs["args_schema"] = schema
            return cls(**kwargs)

        # ── Helpers ──────────────────────────────────────────────────────────

        def _format_preview(self, tool_input: Any) -> dict[str, str]:
            """Serialize tool_input to an Airlock preview dict."""
            if isinstance(tool_input, dict):
                body = json.dumps(tool_input, indent=2, ensure_ascii=False)
            else:
                body = str(tool_input)
            return {"format": self.airlock_preview_format, "body": body}

        def _make_title(self, tool_input: Any) -> str:
            """Build a concise inbox card title from the tool input."""
            if isinstance(tool_input, str) and len(tool_input) <= 80:
                return f"[{self.name}] {tool_input}"
            if isinstance(tool_input, dict):
                first = next(iter(tool_input.values()), None)
                if isinstance(first, str) and len(first) <= 80:
                    return f"[{self.name}] {first}"
            return f"[{self.name}] — awaiting human approval"

        def _effective_input(self, original: Any, decision: dict[str, Any]) -> Any:
            """Return the human-edited input when the reviewer changed preview.body.

            If ``decision.diff`` is absent, the original input is returned
            unchanged. If the reviewer edited the body and the original was a
            dict, we try to parse it back as JSON; on failure we return the raw
            string so the wrapped tool can decide what to do.
            """
            if not decision.get("diff"):
                return original
            final_preview = decision.get("final_preview")
            if not final_preview:
                return original
            edited_body: str = final_preview.get("body", "")
            if isinstance(original, dict):
                try:
                    return json.loads(edited_body)
                except json.JSONDecodeError:
                    return edited_body
            return edited_body

        # ── BaseTool interface ────────────────────────────────────────────────

        def _run(
            self,
            *args: Any,
            run_manager: Optional[CallbackManagerForToolRun] = None,
            **kwargs: Any,
        ) -> str:
            """Gate the wrapped tool behind an Airlock approval, then run it.

            Normalises positional and keyword arguments from both plain-string
            and structured (args_schema) tool calls before pushing to the inbox.

            Raises:
                AirlockRejected: propagated from ``await_decision`` when rejected.
                AirlockTimeout:  propagated from ``await_decision`` on timeout.
            """
            # Normalise tool_input from whatever LangChain / LangGraph passes.
            # LangGraph ToolNode passes structured kwargs when args_schema is set;
            # plain string tools pass a single positional arg.
            if args and not kwargs:
                tool_input: Any = args[0] if len(args) == 1 else list(args)
            elif kwargs and not args:
                # Drop run_manager from kwargs — it's LangChain internal plumbing.
                tool_input = {k: v for k, v in kwargs.items() if k != "run_manager"}
            elif args and kwargs:
                clean_kw = {k: v for k, v in kwargs.items() if k != "run_manager"}
                tool_input = {"_args": list(args), **clean_kw}
            else:
                tool_input = ""

            # 1. Submit proposed action to the Airlock inbox.
            action = self.airlock_client.create_action(
                kind=self.airlock_kind,
                title=self._make_title(tool_input),
                preview=self._format_preview(tool_input),
                editable=self.airlock_editable,
            )
            action_id: str = action["id"]

            # 2. Block (polling) until a human decides.
            approved = self.airlock_client.await_decision(
                action_id,
                timeout_s=self.airlock_timeout_s,
                poll_interval_s=self.airlock_poll_interval_s,
            )
            # AirlockRejected / AirlockTimeout propagate automatically.

            # 3. Resolve the effective input — reviewer may have edited preview.body.
            decision = approved.get("decision") or {}
            effective = self._effective_input(tool_input, decision)

            # 4. Execute the wrapped tool and close the audit loop.
            if self.airlock_report_result:
                try:
                    result: str = self.wrapped_tool.run(effective)
                    self.airlock_client.report_result(action_id, "executed")
                    return result
                except AirlockRejected:
                    raise  # decision reversal guard — should not happen here
                except Exception as exc:
                    # Best-effort: if report_result itself fails the original
                    # exception is more important and re-raised below.
                    try:
                        self.airlock_client.report_result(
                            action_id, "execute_failed", detail=str(exc)
                        )
                    except Exception:
                        pass
                    raise
            else:
                return self.wrapped_tool.run(effective)

        async def _arun(
            self,
            *args: Any,
            run_manager: Optional[Any] = None,
            **kwargs: Any,
        ) -> str:
            """Async variant — delegates to ``_run`` (synchronous blocking poll).

            For fully non-blocking async flows, use ``AirlockClient.await_decision``
            directly inside an ``asyncio`` coroutine with ``asyncio.sleep`` instead
            of ``time.sleep``.
            """
            return self._run(*args, run_manager=run_manager, **kwargs)

else:
    # Stub so the module imports cleanly without langchain-core.
    class AirlockApprovalTool:  # type: ignore[no-redef]
        """Stub — ``langchain-core`` is not installed."""

        @classmethod
        def wrap(cls, *args: Any, **kwargs: Any) -> "AirlockApprovalTool":
            raise ImportError(
                "langchain-core is required to use AirlockApprovalTool. "
                "Install it with:  pip install langchain-core"
            )

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            raise ImportError(
                "langchain-core is required to use AirlockApprovalTool. "
                "Install it with:  pip install langchain-core"
            )
