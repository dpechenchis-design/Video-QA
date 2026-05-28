// api/analyze.js — аналіз відео через Anthropic API
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Ти — QA-спеціаліст контент-агенції EGA. Перевіряєш відео перед здачею клієнту.

Тобі надається аудіо з відео. Зроби повний аналіз:

1. ТРАНСКРИБУЙ аудіо повністю
2. ЗНАЙДИ проблеми по категоріях:

ГРАМАТИКА (з транскрипту):
- Слова-паразити: "um", "uh", "like", "you know", "basically", "literally", "actually", "so", "right" (EN) / "ну", "е", "е-е", "тобто", "значить", "от", "типу", "як би", "ну от" (UK) / "ну", "э", "типа", "короче", "значит", "вот", "как бы" (RU)
- Повтори слів підряд: "and and", "the the", "і і" — невирізаний дубль
- Незакінчені речення — думка обривається
- Неправильно вимовлені слова

АУДІО ЯКІСТЬ:
- Кліпінг — голос спотворюється, "зашкалює"
- Різкі стрибки гучності між кліпами
- Тиша >2 секунд без очевидної причини
- Фоновий шум — вентилятор, луна, вулиця
- Музика перебиває спікера

ВІДПОВІДАЙ ТІЛЬКИ JSON (без markdown, без пояснень):
{
  "language": "en|uk|ru",
  "transcript": "повний текст транскрипту",
  "errors": {
    "critical": [{"timecode":"MM:SS","category":"граматика|аудіо","description":"опис","quote":"цитата до 60 символів"}],
    "important": [...],
    "minor": [...]
  },
  "stats": {
    "fillers_per_minute": 2.5,
    "total_words": 380,
    "clean_percentage": 94
  },
  "verdict": "pass|warn|fail",
  "summary": "одне речення"
}

ПРАВИЛА ПРІОРИТЕТІВ:
- critical: кліпінг, повтори слів (дублі), голос нерозбірливий
- important: >3 слова-паразити на хвилину, тривала тиша, різкий стрибок гучності
- minor: 1-2 слова-паразити за весь ролик, незначний фоновий шум

Якщо слів-паразитів 1-2 за весь ролик — не вказуй їх взагалі. Не вигадуй проблем яких немає.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { audioBase64, videoMeta, sourceUrl } = req.body;

  if (!audioBase64) {
    return res.status(400).json({ error: "Немає аудіо даних" });
  }

  try {
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Відео для QA перевірки.
URL: ${sourceUrl || "завантажено напряму"}
Тривалість: ${videoMeta?.durationStr || "невідомо"}
Роздільна здатність: ${videoMeta?.resolution || "невідомо"}
Орієнтація: ${videoMeta?.orientation || "невідомо"}

Проаналізуй аудіо і поверни результат у JSON.`,
          },
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "audio/mpeg",
              data: audioBase64,
            },
          },
        ],
      },
    ];

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Парсимо JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude не повернув JSON");

    const analysis = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ ok: true, analysis });
  } catch (err) {
    console.error("Claude error:", err);
    return res.status(500).json({ error: err.message });
  }
}
