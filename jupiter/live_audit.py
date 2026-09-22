#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from agent import CandidateProfile, JupiterAgent
from engine import JupiterWebEngine
from site_compat import (
    AUDITED_SOURCE_URLS,
    profile_for_url,
)


def validate_audited_url(url: str) -> str:
    value = str(url or "").strip()
    if not value.startswith("https://"):
        raise ValueError("Live dry-run accepts HTTPS audited employer URLs only")
    profile = profile_for_url(value)
    if profile is None:
        raise ValueError("URL host is not in the 62-employer Jupiter audit registry")
    return value


def _action_counts(trajectory: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in trajectory:
        action = str(item.get("action") or "unknown")
        counts[action] = counts.get(action, 0) + 1
    return counts


def run_target(
    name: str,
    url: str,
    profile: CandidateProfile,
    *,
    timeout: float = 15.0,
    max_steps: int = 18,
    include_snapshot: bool = False,
) -> dict[str, Any]:
    target = validate_audited_url(url)
    engine = JupiterWebEngine(
        set(),
        timeout=timeout,
        max_response_bytes=3 * 1024 * 1024,
        read_only=True,
    )
    agent = JupiterAgent(
        set(),
        max_steps=max_steps,
        engine=engine,
        dry_run=True,
    )
    result = agent.run(target, profile)
    snapshot = engine.semantic_snapshot()
    actions = _action_counts(result.trajectory)
    controls = snapshot.get("controls", []) if isinstance(snapshot, dict) else []
    filled = [
        {
            "name": item.get("name", ""),
            "id": item.get("id", ""),
            "type": item.get("type", ""),
            "value": (
                "<attached>"
                if item.get("file_attached")
                else item.get("value", "")
            ),
            "checked": bool(item.get("checked")),
        }
        for item in controls
        if (
            item.get("file_attached")
            or item.get("checked")
            or str(item.get("value") or "").strip()
        )
        and str(item.get("type") or "").lower()
        not in {"hidden", "submit", "button", "image"}
    ]
    payload = {
        "company": name,
        "start_url": target,
        "final_url": snapshot.get("url") if isinstance(snapshot, dict) else None,
        "status": result.status,
        "reason": result.reason,
        "read_only": True,
        "filled_count": len(filled),
        "filled_controls": filled,
        "actions": actions,
        "trajectory": result.trajectory,
        "script_history": (
            snapshot.get("script_history", [])
            if isinstance(snapshot, dict)
            else []
        ),
    }
    if include_snapshot:
        payload["snapshot"] = snapshot
    return payload


def run_all(
    profile: CandidateProfile,
    *,
    workers: int = 4,
    timeout: float = 15.0,
    max_steps: int = 18,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, min(workers, 8))) as pool:
        futures = {
            pool.submit(
                run_target,
                name,
                url,
                profile,
                timeout=timeout,
                max_steps=max_steps,
            ): name
            for name, url in AUDITED_SOURCE_URLS.items()
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                results.append(future.result())
            except Exception as exc:
                results.append({
                    "company": name,
                    "start_url": AUDITED_SOURCE_URLS[name],
                    "status": "failed",
                    "reason": f"{type(exc).__name__}: {exc}",
                    "read_only": True,
                    "filled_count": 0,
                    "filled_controls": [],
                    "actions": {},
                    "trajectory": [],
                    "script_history": [],
                })

    order = {name: index for index, name in enumerate(AUDITED_SOURCE_URLS)}
    results.sort(key=lambda item: order.get(str(item.get("company")), 9999))
    summary: dict[str, int] = {}
    for item in results:
        status = str(item.get("status") or "unknown")
        summary[status] = summary.get(status, 0) + 1
    return {
        "read_only": True,
        "total": len(results),
        "summary": summary,
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only live compatibility audit for Jupiter employer forms"
    )
    parser.add_argument("--profile", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true")
    group.add_argument("--url")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--max-steps", type=int, default=18)
    parser.add_argument("--output")
    args = parser.parse_args()

    profile = CandidateProfile.load(args.profile)
    if args.all:
        payload = run_all(
            profile,
            workers=args.workers,
            timeout=args.timeout,
            max_steps=args.max_steps,
        )
    else:
        target = validate_audited_url(args.url)
        site = profile_for_url(target)
        payload = run_target(
            site.name if site else "audited employer",
            target,
            profile,
            timeout=args.timeout,
            max_steps=args.max_steps,
        )

    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(rendered + "\n", encoding="utf-8")
    else:
        sys.stdout.write(rendered + "\n")

    statuses = (
        payload.get("summary", {})
        if isinstance(payload, dict) and "summary" in payload
        else {str(payload.get("status") or "unknown"): 1}
    )
    hard_failures = int(statuses.get("failed", 0))
    return 1 if hard_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
