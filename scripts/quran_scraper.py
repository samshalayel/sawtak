#!/usr/bin/env python3
"""
Quran Reels Scraper
-------------------
Scrapes quranreels.tech API for calm/peaceful Quran verses.
Outputs JSON with verse text, audio URLs, and translations.

Usage:
    python quran_scraper.py                  # Get all calm verses
    python quran_scraper.py --surah 13 --start 28 --end 28  # Specific verse
    python quran_scraper.py --topic calm     # By topic (calm, patience, rizq, tawbah, night)
"""

import json
import argparse
import requests
from typing import Optional

BASE_URL = "https://quranreels.tech"
# Quran.com API for verse text (quranreels uses this under the hood)
QURAN_API = "https://api.quran.com/api/v4"
# EveryAyah for audio
AUDIO_BASE = "https://everyayah.com/data"


def get_topics() -> dict:
    """Fetch available message topics from quranreels.tech"""
    resp = requests.get(f"{BASE_URL}/api/quran/message-topics", timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if data.get("success"):
        return data.get("topics", {})
    return {}


def get_reciters() -> list:
    """Fetch available reciters from quranreels.tech"""
    resp = requests.get(f"{BASE_URL}/api/quran/high-quality-reciters", timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if data.get("success"):
        return data.get("reciters", [])
    return []


def get_verse_text(surah: int, verse: int) -> dict:
    """Fetch verse text from Quran.com API"""
    url = f"{QURAN_API}/quran/verses/uthmani?verse_key={surah}:{verse}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    verses = data.get("verses", [])
    if verses:
        return {
            "verse_key": verses[0].get("verse_key"),
            "text_uthmani": verses[0].get("text_uthmani"),
        }
    return {}


def get_verse_translation(surah: int, verse: int, translation_id: int = 85) -> str:
    """Fetch verse translation (default: English - Abdel Haleem)"""
    url = f"{QURAN_API}/quran/translations/{translation_id}?verse_key={surah}:{verse}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    translations = data.get("translations", [])
    if translations:
        return translations[0].get("text", "")
    return ""


def get_audio_url(surah: int, verse: int, reciter: str = "Alafasy_64kbps") -> str:
    """Build audio URL for a verse"""
    # Format: 3-digit surah + 3-digit verse (e.g., 013028 for Surah 13, Verse 28)
    verse_code = f"{surah:03d}{verse:03d}"
    return f"{AUDIO_BASE}/{reciter}/{verse_code}.mp3"


def get_surah_name(surah_num: int) -> str:
    """Get surah name from Quran.com API"""
    url = f"{QURAN_API}/chapters/{surah_num}"
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        chapter = data.get("chapter", {})
        return chapter.get("name_arabic", f"سورة {surah_num}")
    except:
        return f"سورة {surah_num}"


def scrape_verse(surah: int, start: int, end: int, reciter: str = "Alafasy_64kbps") -> list:
    """Scrape verses from surah:start to surah:end"""
    results = []
    surah_name = get_surah_name(surah)

    for verse_num in range(start, end + 1):
        print(f"جاري جلب الآية {surah}:{verse_num}...")

        verse_data = get_verse_text(surah, verse_num)
        translation = get_verse_translation(surah, verse_num)
        audio_url = get_audio_url(surah, verse_num, reciter)

        results.append({
            "surah": surah,
            "surah_name": surah_name,
            "verse": verse_num,
            "verse_key": f"{surah}:{verse_num}",
            "text_arabic": verse_data.get("text_uthmani", ""),
            "translation_en": translation,
            "audio_url": audio_url,
            "reciter": reciter,
        })

    return results


def scrape_topic(topic: str, reciter: str = "Alafasy_64kbps") -> list:
    """Scrape all verses for a specific topic (calm, patience, rizq, etc.)"""
    topics = get_topics()

    if topic not in topics:
        print(f"الموضوع '{topic}' غير موجود. المواضيع المتاحة: {list(topics.keys())}")
        return []

    topic_data = topics[topic]
    verses_list = topic_data.get("verses", [])

    print(f"الموضوع: {topic_data.get('label', topic)}")
    print(f"عدد الآيات: {sum(v['end'] - v['start'] + 1 for v in verses_list)}")

    all_results = []
    for verse_info in verses_list:
        surah = verse_info["surah"]
        start = verse_info["start"]
        end = verse_info["end"]
        label = verse_info.get("label", "")

        print(f"\n--- {label} ---")
        results = scrape_verse(surah, start, end, reciter)

        for r in results:
            r["topic"] = topic
            r["topic_label"] = topic_data.get("label", topic)
            r["verse_label"] = label

        all_results.extend(results)

    return all_results


def main():
    parser = argparse.ArgumentParser(description="Quran Reels Scraper")
    parser.add_argument("--surah", type=int, help="Surah number")
    parser.add_argument("--start", type=int, help="Start verse")
    parser.add_argument("--end", type=int, help="End verse")
    parser.add_argument("--topic", type=str, help="Topic (calm, patience, rizq, tawbah, night)")
    parser.add_argument("--reciter", type=str, default="Alafasy_64kbps", help="Reciter code")
    parser.add_argument("--list-topics", action="store_true", help="List available topics")
    parser.add_argument("--list-reciters", action="store_true", help="List available reciters")
    parser.add_argument("--output", "-o", type=str, help="Output JSON file")

    args = parser.parse_args()

    if args.list_topics:
        topics = get_topics()
        print("\n=== المواضيع المتاحة ===\n")
        for key, data in topics.items():
            verses = data.get("verses", [])
            count = sum(v["end"] - v["start"] + 1 for v in verses)
            print(f"  {key}: {data.get('label', key)} ({count} آية)")
        return

    if args.list_reciters:
        reciters = get_reciters()
        print("\n=== القراء المتاحون ===\n")
        for r in reciters:
            print(f"  {r['value']}: {r['name']} ({r.get('quality', 'N/A')})")
        return

    results = []

    if args.topic:
        results = scrape_topic(args.topic, args.reciter)
    elif args.surah and args.start:
        end = args.end or args.start
        results = scrape_verse(args.surah, args.start, end, args.reciter)
    else:
        # Default: scrape "calm" topic
        print("جاري جلب آيات السكينة والطمأنينة...")
        results = scrape_topic("calm", args.reciter)

    # Print results
    print(f"\n=== النتائج ({len(results)} آية) ===\n")
    for r in results:
        print(f"[{r['verse_key']}] {r['surah_name']}")
        print(f"  {r['text_arabic']}")
        print(f"  EN: {r['translation_en'][:80]}..." if len(r.get('translation_en', '')) > 80 else f"  EN: {r.get('translation_en', '')}")
        print(f"  Audio: {r['audio_url']}")
        print()

    # Save to file if requested
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"\nتم الحفظ في: {args.output}")


if __name__ == "__main__":
    main()
