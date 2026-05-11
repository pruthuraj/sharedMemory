"""
OpenAI Agent connected to the shared memory server.

Two modes:
  - MCP mode (default): uses OpenAI Agents SDK + MCP stdio adapter
  - WS mode: uses WebSocket directly as OpenAI function tools

Install:
    pip install openai-agents websockets

Run:
    python examples/openai_agent.py
    python examples/openai_agent.py --ws   # WebSocket mode
"""

import asyncio
import json
import sys
import os

# ── MCP mode ──────────────────────────────────────────────────────────────────

async def run_mcp_agent():
    """Connect via MCP stdio — the server exposes memory_set/get/search/map."""
    from agents import Agent, Runner
    from agents.mcp import MCPServerStdio

    mcp_server_path = os.path.join(
        os.path.dirname(__file__), "..", "mcp-server.mjs"
    )

    async with MCPServerStdio(
        params={"command": "node", "args": [os.path.abspath(mcp_server_path)]}
    ) as memory:
        agent = Agent(
            name="memory-agent",
            model="gpt-4o",
            instructions=(
                "You are a helpful assistant with access to a shared memory store. "
                "Use memory_get and memory_search to recall context, and memory_set "
                "to save anything important for future sessions."
            ),
            mcp_servers=[memory],
        )

        print("MCP agent ready. Type your message (ctrl+c to quit):\n")
        while True:
            try:
                user_input = input("You: ").strip()
                if not user_input:
                    continue
                result = await Runner.run(agent, user_input)
                print(f"Agent: {result.final_output}\n")
            except KeyboardInterrupt:
                print("\nBye!")
                break


# ── WebSocket mode ─────────────────────────────────────────────────────────────

async def ws_memory_call(method: str, params: dict, port: int = 3000) -> dict:
    """Send one command to the WS server and return the response."""
    import websockets

    async with websockets.connect(f"ws://localhost:{port}") as ws:
        await ws.recv()  # welcome
        await ws.send(json.dumps({"type": method, "requestId": "1", **params}))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("requestId") == "1":
                return msg


def make_ws_tools(port: int = 3000):
    """Return OpenAI function tool definitions + a dispatcher for WS memory ops."""
    from openai import AsyncOpenAI

    tools = [
        {
            "type": "function",
            "function": {
                "name": "memory_set",
                "description": "Store a value in shared memory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "key":     {"type": "string"},
                        "value":   {"type": "string"},
                        "summary": {"type": "string"},
                    },
                    "required": ["key", "value"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "memory_get",
                "description": "Retrieve a value from shared memory by key.",
                "parameters": {
                    "type": "object",
                    "properties": {"key": {"type": "string"}},
                    "required": ["key"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "memory_search",
                "description": "Search shared memory by keyword.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer", "default": 10},
                    },
                    "required": ["query"],
                },
            },
        },
    ]

    async def dispatch(name: str, args: dict) -> str:
        if name == "memory_set":
            r = await ws_memory_call("set", args, port)
        elif name == "memory_get":
            r = await ws_memory_call("get", args, port)
        elif name == "memory_search":
            r = await ws_memory_call("search", args, port)
        else:
            return json.dumps({"error": "unknown tool"})
        return json.dumps(r)

    return tools, dispatch


async def run_ws_agent():
    """Connect via WebSocket — memory ops exposed as OpenAI function tools."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI()
    tools, dispatch = make_ws_tools()

    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful assistant with access to a shared memory store. "
                "Use memory_get and memory_search to recall context, and memory_set "
                "to save anything important for future sessions."
            ),
        }
    ]

    print("WS agent ready. Type your message (ctrl+c to quit):\n")
    while True:
        try:
            user_input = input("You: ").strip()
            if not user_input:
                continue

            messages.append({"role": "user", "content": user_input})

            # Agentic loop
            while True:
                response = await client.chat.completions.create(
                    model="gpt-4o",
                    messages=messages,
                    tools=tools,
                )
                msg = response.choices[0].message
                messages.append(msg)

                if not msg.tool_calls:
                    print(f"Agent: {msg.content}\n")
                    break

                for tc in msg.tool_calls:
                    result = await dispatch(tc.function.name, json.loads(tc.function.arguments))
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    })

        except KeyboardInterrupt:
            print("\nBye!")
            break


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--ws" in sys.argv:
        asyncio.run(run_ws_agent())
    else:
        asyncio.run(run_mcp_agent())
