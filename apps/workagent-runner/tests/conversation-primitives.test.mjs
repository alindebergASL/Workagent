import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { calculate } from '../src/calculate.mjs';
import { publicAddress, publicReader, publicIntent, lookupPublic, currentWeather, dailyForecast } from '../src/public-lookup.mjs';

test('bounded arithmetic consumes the entire expression and never returns a nonfinite or out-of-range result', () => {
  for (const [expression, expected] of [['10-6/2-1', 6], ['-(1 + .25)*4', -5], ['19.99 * 15 / 100', 19.99*15/100]]) assert.equal(calculate(expression).value, expected);
  for (const expression of ['', '1 2', '(1+2', '1+2)', '2**3', 'a()', '1+'.repeat(128)+'1']) assert.throws(() => calculate(expression), /invalid_arithmetic/);
  assert.throws(() => calculate('1/(1-1)'), /division_by_zero/);
  assert.throws(() => calculate('9007199254740991+1'), /calculation_out_of_range/);
});

test('socket selection refuses nonpublic and mixed A answers, never falls back to a hostname', () => {
  assert.equal(publicAddress(['1.1.1.1']), '1.1.1.1');
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.1.1','100.64.1.1','192.168.1.1','172.16.1.1','224.0.0.1','::1','example.org']) assert.throws(() => publicAddress(['1.1.1.1',ip]), /public_address_required/);
  assert.throws(() => publicAddress([]), /public_address_required/);
});

test('reader refuses foreign endpoints, aborted requests, non-JSON, malformed and oversized streams', async () => {
  const search = 'https://en.wikipedia.org/w/rest.php/v1/search/page';
  let calls = 0;
  const ctrl = new AbortController();
  const read = publicReader({ authorize: async () => {}, signal: ctrl.signal, open() { calls++; } });
  await assert.rejects(read('https://example.org/', {}), /public_endpoint_required/);
  ctrl.abort(); await assert.rejects(read(search, {}), {name: 'AbortError'});
  assert.equal(calls, 0);
  for (const [type, chunks] of [['text/html', ['{}']], ['application/json', ['{']], ['application/json', [' '.repeat(32768), ' '.repeat(32768)+'{}']]]) {
    const stream = Object.assign(Readable.from(chunks.map(c => Buffer.from(c))), { statusCode: 200, headers: { 'content-type': type } });
    const read = publicReader({ authorize: async () => {}, open: async () => stream, signal: new AbortController().signal });
    await assert.rejects(read(search, {}), /public_source_unavailable/);
    assert.equal(stream.destroyed, true);
  }
});

test('a standalone public question grants only its exact arguments on this turn', () => {
  assert.deepEqual(publicIntent('What is the weather in "Québec City", Canada?'), { weather: { location: 'Québec City', region: 'Canada' } });
  assert.deepEqual(publicIntent('Please look up basalt on Wikipedia.'), { lookup: { query: 'basalt' } });
});

test('lookup rejects invented delimiters, changed terms and private context before any read', async () => {
  const quoted = publicIntent('Look up "tidal bore" and current weather in Bergen.').lookup;
  const bare = publicIntent('Look up basalt.').lookup;
  let reads = 0;
  for (const [intent, queries] of [
    [quoted, ['"tidal"', '"Tidal bore"', '"tidal  bore"', '"tidal bore', '“tidal bore”', '""tidal bore""', '"Bergen"', '"Private notes"']],
    [bare, ['"basalt"', undefined]],
    [publicIntent('Look up "tidal bore" using my private notes.').lookup, ['tidal bore', '"tidal bore"']],
  ]) {
    for (const query of queries) await assert.rejects(lookupPublic({ query }, intent, () => { reads++; }), /ask_user_to_confirm_exact_public_terms/);
  }
  assert.equal(reads, 0);
});

const forecastPlace = { name: 'Example Port', country: 'Example', latitude: 10, longitude: 170 };
const forecastArgs = { location: forecastPlace.name, region: forecastPlace.country, day: 'tomorrow' };
const retrievedAt = '2028-02-28T22:30:00Z'; // Already leap day at the resolved location.
function forecastData() {
  return { timezone: 'Pacific/Fiji', daily_units: { temperature_2m_min: '°C', temperature_2m_max: '°C' },
    daily: { time: ['2028-02-29', '2028-03-01'], temperature_2m_min: [8, 10], temperature_2m_max: [17, 19] } };
}

test('daily forecast requires a complete turn directive and exact place, qualifier and day', async () => {
  const directive = 'Get the daily forecast in "Example Port", Example for tomorrow';
  const { forecast } = publicIntent(directive);
  assert.deepEqual(forecast, forecastArgs);
  for (const text of [`Do not ${directive}`, `${directive} using my notes`, directive.replace('tomorrow', 'next month'), `${directive} and ${directive}`]) {
    assert.deepEqual(publicIntent(text), {});
  }
  let reads = 0;
  for (const change of [{ location: 'example port' }, { region: undefined }, { region: 'Other' }, { day: 'today' }]) {
    await assert.rejects(dailyForecast({ ...forecastArgs, ...change }, forecast, () => { reads++; }), /ask_user_to_confirm_exact_public_terms/);
  }
  assert.equal(reads, 0);
});

test('daily forecast selects the authorized local calendar day across a UTC month boundary', async () => {
  for (const [index, day] of ['today', 'tomorrow'].entries()) {
    const args = { ...forecastArgs, day }, data = forecastData();
    for (const values of Object.values(data.daily)) values.length = index + 1;
    const calls = [];
    const result = await dailyForecast(args, args, async (endpoint, params) => {
      calls.push({ endpoint, params });
      return { data: calls.length === 1 ? { results: [forecastPlace] } : data, sourceUrl: endpoint, retrievedAt };
    });
    assert.deepEqual(calls, [
      { endpoint: 'https://geocoding-api.open-meteo.com/v1/search', params: { name: args.location, count: '8', language: 'en', format: 'json' } },
      { endpoint: 'https://api.open-meteo.com/v1/forecast', params: { latitude: forecastPlace.latitude, longitude: forecastPlace.longitude,
        daily: 'temperature_2m_min,temperature_2m_max', forecast_days: String(index + 1), timezone: 'auto' } }]);
    assert.deepEqual([result.source, result.date, result.timezone, result.minC, result.maxC],
      ['Open-Meteo daily forecast', data.daily.time[index], data.timezone, data.daily.temperature_2m_min[index], data.daily.temperature_2m_max[index]]);
    assert.equal(result.location.name, forecastPlace.name);
    assert.equal(result.sourceUrl, calls[1].endpoint);
    assert.equal(result.retrievedAt, retrievedAt);
  }
});

test('forecast rejects stale, gapped, oversized, malformed or inconsistent daily data', async () => {
  for (const corrupt of [d => { d.daily.time = ['2028-02-28', '2028-02-29']; }, d => { d.daily.time[1] = '2028-03-02'; },
    d => { d.daily.temperature_2m_max.push(20); }, d => { d.daily.temperature_2m_min.pop(); }, d => { d.daily.temperature_2m_max[1] = null; },
    d => { d.daily.temperature_2m_min[1] = 30; }, d => { d.timezone = 'Invalid/Zone'; }, d => { delete d.timezone; }, d => { d.daily_units.temperature_2m_min = '°F'; }]) {
    const data = forecastData(); corrupt(data);
    await assert.rejects(dailyForecast(forecastArgs, forecastArgs, async endpoint => ({
      data: endpoint.includes('geocoding-api') ? { results: [forecastPlace] } : data, retrievedAt })), /public_source_unavailable/);
  }
});

test('weather chooses a unique normalized name among qualified candidates', async () => {
  const args = { location: 'Québec', region: 'Canada' }, calls = [];
  const city = { name: 'QUE\u0301BEC', country: 'CANADA', latitude: 46.8, longitude: -71.2 };
  const result = await currentWeather(args, args, async (endpoint, params) => {
    calls.push(endpoint);
    if (calls.length === 1) return { data: { results: [{ ...city, name: 'Québecville', latitude: 45 }, city] } };
    assert.equal(params.latitude, city.latitude);
    return { data: { current: { time: '2026-11-20T08:30', temperature_2m: 4, weather_code: 3 },
      utc_offset_seconds: 0, current_units: { temperature_2m: '°C' } }, retrievedAt: '2026-11-20T08:35:00Z' };
  });
  assert.equal(calls.length, 2);
  assert.equal(result.location.name, city.name);
  assert.equal(result.temperatureC, 4);
});

test('weather asks about a sole same-country near match without fetching conditions', async () => {
  const calls = [];
  const candidate = { name: 'Bergensvika', country: 'Norway', latitude: 60, longitude: 5 };
  const result = await currentWeather({ location: 'Bergen', region: 'Norway' }, { location: 'Bergen', region: 'Norway' }, async endpoint => {
    calls.push(endpoint); return { data: { results: [candidate] }, sourceUrl: 'fixture' };
  });
  assert.deepEqual(calls, ['https://geocoding-api.open-meteo.com/v1/search']);
  assert.equal(result.status, 'clarify_location');
  assert.deepEqual(result.matches.map(p => p.name), ['Bergensvika']);
  assert.equal(result.temperatureC, undefined);
});

test('weather does not fetch or invent conditions for missing or ambiguous places', async () => {
  for (const results of [[], ['North', 'South'].map(admin1 => ({name: 'Example', admin1, latitude: 12, longitude: 34}))]) {
    let requests = 0;
    const result = await currentWeather({location: 'Example'}, {location: 'Example'}, async () => { requests++; return {data: {results}, sourceUrl: 'fixture'}; });
    assert.equal(requests, 1);
    assert.equal(result.status, results.length ? 'clarify_location' : 'location_not_found');
    assert.equal(result.temperatureC, undefined);
  }
});
