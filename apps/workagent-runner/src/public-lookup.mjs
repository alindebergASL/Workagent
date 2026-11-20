import { get } from 'node:https';
import { resolve4 } from 'node:dns/promises';
import { BlockList, isIPv4 } from 'node:net';

// Only these three HTTPS resources are addressable. No URL, headers, proxy,
// cookies, request body or redirect target can be supplied by a model.
const search = 'https://en.wikipedia.org/w/rest.php/v1/search/page';
const places = 'https://geocoding-api.open-meteo.com/v1/search';
const forecast = 'https://api.open-meteo.com/v1/forecast';
const nonPublic = new BlockList();
for (const [net, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) nonPublic.addSubnet(net, bits);
export function publicAddress(addresses) {
  if (!addresses.length || addresses.some(ip => !isIPv4(ip) || nonPublic.check(ip))) throw new Error('public_address_required');
  return addresses[0];
}
function openResponse(url, signal) {
  return new Promise((resolve, reject) => {
    get(url, { signal, family: 4, agent: false, rejectUnauthorized: true,
      headers: { accept: 'application/json', 'user-agent': 'Workagent/0.1 (public conversation lookup)' },
      lookup(host, _, cb) { resolve4(host).then(publicAddress).then(ip => cb(null, ip, 4), cb); },
    }, resolve).once('error', reject);
  });
}

function unavailable() { throw new Error('public_source_unavailable'); }
// Trusted host/test seam is the response stream, not the authorization or parser.
export function publicReader({ open = openResponse, authorize, signal }) {
  let deadline;
  return async (endpoint, params) => {
    deadline ??= AbortSignal.any([signal, AbortSignal.timeout(8000)]);
    if (![search, places, forecast].includes(endpoint)) throw new Error('public_endpoint_required');
    const url = new URL(endpoint);
    url.search = new URLSearchParams(params);
    await authorize();
    deadline.throwIfAborted();
    let res;
    try {
      res = await open(url, deadline);
      if (res.statusCode !== 200 || !/^application\/json(?:\s*;|$)/i.test(res.headers['content-type'] ?? '')) unavailable();
      const chunks = []; let size = 0;
      for await (const chunk of res) {
        if ((size += chunk.byteLength) > 65536) unavailable();
        chunks.push(chunk);
      }
      deadline.throwIfAborted();
      return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')), sourceUrl: url.href, retrievedAt: new Date().toISOString() };
    } catch { signal.throwIfAborted(); unavailable(); }
    finally { res?.destroy(); }
  };
}

// Recognize complete, bounded user directives, never scan prose for a topic.
// Quoting makes a multiword term explicit instead of guessing where context begins.
const term = String.raw`("[\p{L}\p{N}][\p{L}\p{M}\p{N} '’(),-]{0,79}"|[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]{0,79})`;
const lookupDirective = new RegExp(`^(?:please )?look up ${term}(?: on (?:English )?Wikipedia)?$`, 'iu');
const weatherDirective = new RegExp(`^(?:please )?(?:(?:check|get|what is|what's) (?:the )?)?(?:current )?weather (?:in|for) ${term}(?:, *${term})?$`, 'iu');
const forecastDirective = new RegExp(`^(?:please )?(?:(?:check|get|what is|what's) (?:the )?)?(?:daily )?forecast (?:in|for) ${term}(?:, *${term})? for (today|tomorrow)$`, 'iu');
const unquote = s => s?.startsWith('"') ? s.slice(1, -1) : s;
export function publicIntent(request) {
  if (typeof request !== 'string' || request.length > 512) return {};
  const body = request.trim().replace(/[.?]? no file\.?$/i, '').replace(/[.?]$/, '')
    .replace(/^calculate [0-9 ().+*/-]+, +/i, '');
  const intent = {};
  for (const clause of body.split(/ and (?=(?:get |check |current |weather |daily forecast |forecast |look up ))/i)) {
    const topic = lookupDirective.exec(clause);
    if (topic && !intent.lookup) {
      intent.lookup = { query: unquote(topic[1]) };
      if (topic[1] !== intent.lookup.query) intent.lookup.quotedQuery = topic[1];
      continue;
    }
    const place = weatherDirective.exec(clause);
    if (place && !intent.weather) { intent.weather = { location: unquote(place[1]), region: unquote(place[2]) }; continue; }
    const daily = forecastDirective.exec(clause);
    if (daily && !intent.forecast) { intent.forecast = { location: unquote(daily[1]), region: unquote(daily[2]), day: daily[3].toLowerCase() }; continue; }
    return {}; // Unknown prose or conflicting directives: ask, don't dispatch.
  }
  return intent;
}
function requireTerms(match) {
  if (!match) throw new Error('ask_user_to_confirm_exact_public_terms');
}
const text = (v, n) => typeof v === 'string' ? v.replace(/<[^<>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, n) : '';
export async function lookupPublic({ query }, intent, read) {
  requireTerms(intent && typeof query === 'string' && (query === intent.query || query === intent.quotedQuery));
  const { data, ...source } = await read(search, { q: intent.query, limit: '3' });
  if (!Array.isArray(data?.pages)) unavailable();
  const results = data.pages.slice(0, 3).map(p => {
    if (!Number.isSafeInteger(p?.id) || p.id <= 0 || !text(p.title, 160)) unavailable();
    return { title: text(p.title, 160), excerpt: text(p.excerpt, 480), url: `https://en.wikipedia.org/?curid=${p.id}` };
  });
  return { source: 'English Wikipedia search', ...source, results };
}
function place(p) {
  if (!Number.isFinite(p?.latitude) || Math.abs(p.latitude) > 90 || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180 || !text(p.name, 100)) unavailable();
  return { name: text(p.name, 100), region: text(p.admin1, 100), country: text(p.country, 100), latitude: p.latitude, longitude: p.longitude };
}
async function resolvePlace({ location, region }, intent, read) {
  requireTerms(intent && location === intent.location && region === intent.region);
  const { data: geo, sourceUrl: geocodingUrl } = await read(places, { name: intent.location, count: '8', language: 'en', format: 'json' });
  if (!geo || typeof geo !== 'object' || Array.isArray(geo) || geo.error || (geo.results !== undefined && !Array.isArray(geo.results))) unavailable();
  // Compare original provider fields, not truncated or HTML-stripped display labels.
  const key = s => typeof s === 'string' ? s.trim().normalize('NFC').toLowerCase() : '';
  const candidates = (geo.results ?? []).slice(0, 8).filter(p => !region || [p?.admin1, p?.country].some(s => key(s) === key(region)));
  const exact = candidates.filter(p => key(p?.name) === key(location));
  if (exact.length !== 1) {
    const matches = (exact.length ? exact : candidates).map(place);
    return { status: matches.length ? 'clarify_location' : 'location_not_found', geocodingUrl, matches };
  }
  return { location: place(exact[0]), geocodingUrl };
}
export async function currentWeather(args, intent, read) {
  const match = await resolvePlace(args, intent, read);
  if (match.status) return match;
  const { location: resolved, geocodingUrl } = match;
  const { data, ...source } = await read(forecast, { latitude: resolved.latitude, longitude: resolved.longitude, current: 'temperature_2m,weather_code', timezone: 'GMT' });
  const current = data?.current, time = current?.time, at = Date.parse(`${time}Z`), age = Date.parse(source.retrievedAt) - at;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(time) || !Number.isFinite(age) || new Date(at).toISOString().slice(0, 16) !== time || data.utc_offset_seconds !== 0 || !Number.isFinite(current.temperature_2m) || data.current_units?.temperature_2m !== '°C' || !Number.isInteger(current.weather_code) || current.weather_code < 0 || current.weather_code > 99) unavailable();
  if (age < -15 * 60000 || age > 2 * 3600000) throw new Error('weather_not_current');
  return { source: 'Open-Meteo current model conditions', ...source, geocodingUrl, location: resolved, validAt: `${time}Z`, temperatureC: current.temperature_2m, wmoWeatherCode: current.weather_code };
}

export async function dailyForecast(args, intent, read) {
  const day = args.day;
  requireTerms(intent && day === intent.day && (day === 'today' || day === 'tomorrow'));
  const match = await resolvePlace(args, intent, read);
  if (match.status) return match;
  const { latitude, longitude } = match.location, count = day === 'today' ? 1 : 2;
  const { data, ...source } = await read(forecast, { latitude, longitude, daily: 'temperature_2m_min,temperature_2m_max', forecast_days: String(count), timezone: 'auto' });
  const { daily, daily_units: units, timezone } = data ?? {};
  if (typeof timezone !== 'string' || !timezone || timezone.length > 100 || units?.temperature_2m_min !== '°C' || units.temperature_2m_max !== '°C') unavailable();
  const dates = daily?.time, lows = daily?.temperature_2m_min, highs = daily?.temperature_2m_max;
  if (![dates, lows, highs].every(a => Array.isArray(a) && a.length === count)) unavailable();

  // Anchor to the place's calendar date, then advance dates (not instants across DST).
  let midnight;
  try {
    const format = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric' });
    const parts = Object.fromEntries(format.formatToParts(new Date(source.retrievedAt)).map(p => [p.type, p.value]));
    midnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  } catch { unavailable(); }
  for (let i = 0; i < count; i++) {
    if (dates[i] !== new Date(midnight + i * 86400000).toISOString().slice(0, 10) || !Number.isFinite(lows[i]) || !Number.isFinite(highs[i]) || lows[i] > highs[i]) unavailable();
  }
  return { source: 'Open-Meteo daily forecast', ...source, ...match, timezone, date: dates[count-1], minC: lows[count-1], maxC: highs[count-1] };
}
