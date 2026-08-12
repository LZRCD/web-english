# -*- coding: utf-8 -*-
"""抓取市面上主流背词网站页面，保存为 Markdown，用于与词环 WordLoop 对比。

用法:
    python scripts/crawl-competitors.py [--urls a,b,c]
"""
import argparse
import asyncio
import json
import os
import re
import sys
from datetime import datetime
from urllib.parse import urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "competitor-research")
os.makedirs(OUT_DIR, exist_ok=True)

DEFAULT_SITES = {
    "百词斩官网": "https://www.baicizhan.com/",
    "百词斩AppStore": "https://apps.apple.com/cn/app/%E7%99%BE%E8%AF%8D%E6%96%A9/id433519243",
    "墨墨背单词官网": "https://www.maimemo.com/",
    "扇贝单词官网": "https://www.shanbay.com/",
    "不背单词官网": "https://www.bbdc.cn/",
    "知米背单词": "https://www.zhimawang.com/",
    "沪江开心词场": "https://cichang.hujiang.com/",
    "Anki官网": "https://apps.ankiweb.net/",
    "Anki中国": "https://www.ankichina.net/",
    "Quizlet官网": "https://quizlet.com/latest",
    "欧路词典": "https://www.eudic.net/v4/en/app/eudic",
    "多邻国": "https://www.duolingo.cn/",
}

SAFE_NAME = re.compile(r"[^\w\u4e00-\u9fff-]+")


def slug(name: str) -> str:
    return SAFE_NAME.sub("_", name)[:60]


async def crawl_one(crawler: AsyncWebCrawler, name: str, url: str, index: int):
    print(f"[{index}] 抓取 {name}: {url}", flush=True)
    try:
        config = CrawlerRunConfig(
            cache_mode=CacheMode.BYPASS,
            wait_until="domcontentloaded",
            page_timeout=20000,
            verbose=False,
        )
        result = await crawler.arun(url=url, config=config)
        if not result.success:
            print(f"    !! 失败: {result.error_message}", flush=True)
            return None
        md = result.markdown or ""
        md = re.sub(r"\n{3,}", "\n\n", md)
        base = slug(name)
        with open(os.path.join(OUT_DIR, f"{index:02d}-{base}.md"), "w", encoding="utf-8") as f:
            f.write(f"# {name}\n\n来源: {url}\n抓取时间: {datetime.now().isoformat(timespec='seconds')}\n\n---\n\n")
            f.write(md)
        title = (result.metadata.get("title") if result.metadata else None) or ""
        print(f"    OK 标题={title!r} 正文长度={len(md)}", flush=True)
        return {"name": name, "url": url, "title": title, "ok": True, "len": len(md)}
    except Exception as e:  # noqa: BLE001
        print(f"    !! 异常: {e}", flush=True)
        return {"name": name, "url": url, "ok": False, "error": str(e)}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--urls", default="", help="逗号分隔的 url:name 列表，覆盖默认站点")
    parser.add_argument("--only", default="", help="逗号分隔的站点名，只抓这些")
    args = parser.parse_args()

    if args.urls:
        sites = {}
        for item in args.urls.split(","):
            item = item.strip()
            if not item:
                continue
            if ":" in item:
                name, url = item.split(":", 1)
                if url.startswith("http"):
                    sites[name] = url
                    continue
            if item.startswith("http"):
                sites[urlparse(item).netloc] = item
    else:
        sites = dict(DEFAULT_SITES)

    if args.only:
        keep = set(s.strip() for s in args.only.split(","))
        sites = {k: v for k, v in sites.items() if k in keep}

    print(f"共 {len(sites)} 个目标", flush=True)

    browser = BrowserConfig(headless=True, chrome_channel="msedge")
    async with AsyncWebCrawler(config=browser) as crawler:
        results = []
        for i, (name, url) in enumerate(sites.items(), 1):
            r = await crawl_one(crawler, name, url, i)
            if r:
                results.append(r)
        with open(os.path.join(OUT_DIR, "_manifest.json"), "w", encoding="utf-8") as f:
            json.dump({"time": datetime.now().isoformat(timespec="seconds"), "results": results}, f, ensure_ascii=False, indent=2)
    print("完成", flush=True)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
