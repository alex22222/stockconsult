#!/usr/bin/env python3
"""
本地网页搜索工具，替代内置 SearchWeb 工具（返回 404 时可用）。
使用 Bing 搜索，输出标题、链接和摘要。
"""

import argparse
import html
import json
import re
import sys
from urllib.parse import quote

import requests


def search_bing(query: str, limit: int = 5, timeout: int = 20):
    """使用 Bing 搜索并返回结构化结果。"""
    url = f"https://cn.bing.com/search?q={quote(query)}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }

    try:
        resp = requests.get(url, headers=headers, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException as e:
        return {"error": f"请求失败: {e}"}

    # Bing 结果块
    blocks = re.findall(r'<li class="b_algo"[^>]*>(.*?)</li>', resp.text, re.DOTALL)

    results = []
    for block in blocks[:limit]:
        # 标题和链接
        title_match = re.search(
            r'<h2[^>]*>.*?<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', block, re.DOTALL
        )
        if not title_match:
            continue

        link = html.unescape(title_match.group(1))
        title = re.sub(r'<[^>]+>', '', title_match.group(2))
        title = html.unescape(title).strip()

        # 摘要
        snippet_match = re.search(
            r'<p[^>]*>(.*?)</p>', block, re.DOTALL
        ) or re.search(r'<div class="b_caption">.*?<p>(.*?)</p>', block, re.DOTALL)
        snippet = ""
        if snippet_match:
            snippet = re.sub(r'<[^>]+>', '', snippet_match.group(1))
            snippet = html.unescape(snippet).strip()

        results.append({
            "title": title,
            "link": link,
            "snippet": snippet,
        })

    return {
        "query": query,
        "count": len(results),
        "results": results,
    }


def fetch_page(url: str, timeout: int = 20, max_chars: int = 4000):
    """抓取指定 URL 的文本内容。"""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
    }

    try:
        resp = requests.get(url, headers=headers, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException as e:
        return {"error": f"抓取失败: {e}"}

    # 猜测编码
    if resp.encoding == "ISO-8859-1":
        resp.encoding = resp.apparent_encoding

    text = resp.text
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()

    return {
        "url": url,
        "title": resp.url,
        "content": text[:max_chars],
    }


def main():
    parser = argparse.ArgumentParser(description="本地网页搜索工具")
    parser.add_argument("query", help="搜索关键词")
    parser.add_argument("-n", "--limit", type=int, default=5, help="返回结果数量")
    parser.add_argument("-f", "--fetch", help="抓取第 N 个结果的详细内容", type=int)
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出")
    args = parser.parse_args()

    data = search_bing(args.query, limit=args.limit)

    if "error" in data:
        print(data["error"], file=sys.stderr)
        sys.exit(1)

    if args.fetch is not None:
        idx = args.fetch - 1
        if idx < 0 or idx >= len(data["results"]):
            print(f"结果序号 {args.fetch} 超出范围", file=sys.stderr)
            sys.exit(1)
        detail = fetch_page(data["results"][idx]["link"])
        data = detail

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        if "results" in data:
            for i, r in enumerate(data["results"], 1):
                print(f"{i}. {r['title']}")
                print(f"   {r['link']}")
                if r["snippet"]:
                    print(f"   {r['snippet']}")
                print()
        else:
            print(data.get("content", data))


if __name__ == "__main__":
    main()
