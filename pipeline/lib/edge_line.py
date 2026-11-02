# Одна фраза через Edge TTS: mp3 + тайминги слов (WordBoundary). Аргументы: voice rate text out.mp3
import asyncio, json, sys
import edge_tts

async def main(voice, rate, text, out):
    words = []
    comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    with open(out, "wb") as f:
        async for ch in comm.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                s = ch["offset"] / 1e7
                words.append({"w": ch["text"], "s": round(s, 3), "e": round(s + ch["duration"] / 1e7, 3)})
    print(json.dumps(words, ensure_ascii=False))

asyncio.run(main(*sys.argv[1:5]))
