const INTERVALS = new Set([
  "1min", "5min", "15min", "30min",
  "1h", "4h", "1day", "1week"
]);

const json = (data, statusCode = 200) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=15"
  },
  body: JSON.stringify(data)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const key = process.env.TWELVE_DATA_API_KEY;

  if (!key) {
    return json({
      error: "TWELVE_DATA_API_KEY is not configured"
    }, 503);
  }

  const q = event.queryStringParameters || {};
  const symbol = String(q.symbol || "XAU/USD")
    .trim().toUpperCase();

  const interval = String(q.interval || "15min");
  const outputsize = Math.min(
    500,
    Math.max(30, Number(q.limit) || 200)
  );

  if (!/^[A-Z0-9./:_-]{1,40}$/.test(symbol)) {
    return json({ error: "Invalid symbol" }, 400);
  }

  if (!INTERVALS.has(interval)) {
    return json({ error: "Invalid interval" }, 400);
  }

  const params = new URLSearchParams({
    symbol,
    interval,
    outputsize: String(Math.floor(outputsize)),
    timezone: "UTC",
    format: "JSON"
  });

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(), 12000
  );

  try {
    const response = await fetch(
      `https://api.twelvedata.com/time_series?${params}`,
      {
        headers: {
          Authorization: `apikey ${key}`
        },
        signal: controller.signal
      }
    );

    const data = await response.json();

    if (!response.ok || data.status === "error") {
      return json({
        error: data.message || "Market data unavailable",
        code: data.code || response.status
      }, response.status === 429 ? 429 : 502);
    }

    const candles = (data.values || [])
      .map(c => ({
        datetime: c.datetime,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: c.volume == null
          ? null : Number(c.volume)
      }))
      .filter(c =>
        [c.open, c.high, c.low, c.close]
          .every(Number.isFinite)
      )
      .reverse();

    return json({
      success: true,
      symbol,
      interval,
      source: "Twelve Data",
      fetchedAt: new Date().toISOString(),
      timezone: data.meta?.exchange_timezone || "UTC",
      candles
    });

  } catch (error) {
    return json({
      error: error.name === "AbortError"
        ? "Market data request timed out"
        : "Market data connection failed"
    }, 502);
  } finally {
    clearTimeout(timeout);
  }
};
