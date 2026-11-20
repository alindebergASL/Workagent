import { defineTool } from '@deepseek-ai/dsh-tools';
import { calculate } from './calculate.mjs';
import { currentWeather, dailyForecast, lookupPublic, publicIntent, publicReader } from './public-lookup.mjs';

// Use native tool presentation metadata for lookup replies. It is written only
// after execution succeeds and is not part of the provider's message content.
function lookupPart(name, r) {
  if (name === 'lookup_public') {
    if (!r.results.length) return 'English Wikipedia search returned no results.';
    const entries = r.results.map(({ title, excerpt, url }) =>
      `${title}: ${excerpt ? `“${excerpt}”` : '(no excerpt returned)'}\n${url}`);
    return `English Wikipedia search excerpts (retrieved ${r.retrievedAt}):\n${entries.join('\n\n')}`;
  }
  if (name === 'calculate') return `Calculation: ${r.expression} = ${r.value}`;
  if (r.status === 'location_not_found') return 'Open-Meteo did not find the requested place.';
  if (r.status === 'clarify_location') return `Please clarify the place: ${r.matches.map(p => [p.name, p.region, p.country].filter(Boolean).join(', ')).join('; ')}.`;
  const place = [r.location.name, r.location.region, r.location.country].filter(Boolean).join(', ');
  if (name === 'current_weather') return `${r.source}: ${place}, ${r.temperatureC} °C at ${r.validAt} (WMO code ${r.wmoWeatherCode}).\n${r.sourceUrl}`;
  if (name === 'daily_forecast') return `${r.source}: ${place}, ${r.date} (${r.timezone}), low ${r.minC} °C, high ${r.maxC} °C.\n${r.sourceUrl}`;
}

export function lookupReplyTools(job) {
  if (job.kind || job.work?.kind !== 'conversation') return;
  const intent = publicIntent(job.text);
  if (intent.lookup) return [
    ...(/^calculate /i.test(job.text.trim()) ? ['calculate'] : []), 'lookup_public',
    ...(intent.weather ? ['current_weather'] : []), ...(intent.forecast ? ['daily_forecast'] : []),
  ];
}

// Used both at completion and during restart. Keep raw assistant messages in
// the native journal, not in product history (including intermediate prose).
export function lookupReply(tools, events, outcome) {
  if (outcome?.status !== 'ready') return [];
  const turn = events.findLast(e => e.type === 'turn/end').data.turn;
  const final = events.findLast(e => e.type === 'assistant/message' && e.data.turn === turn);
  const parts = new Map();
  for (const { type, data } of events) {
    if (type !== 'tool/result' || data.turn !== turn || data.message.isError) continue;
    const part = data.meta?.workagentLookupPart;
    if (part && tools.includes(part.name)) parts.set(part.name, part.text);
  }
  const missing = { lookup_public: 'No English Wikipedia search result was available.', calculate: 'Calculation unavailable.',
    current_weather: 'Current conditions unavailable.', daily_forecast: 'Daily forecast unavailable.' };
  return [{ id: final.data.message.id, role: 'assistant', text: tools.map(name => parts.get(name) ?? missing[name]).join('\n\n') }];
}

export function registerConversationTools(ctx, job, authorize, open) {
  const intent = publicIntent(job.text);
  let publicReads = 0;
  const register = (name, description, parameters, run) => ctx.tools.register(defineTool({
    name, description, parameters,
    output: { schema: { type: 'string' }, render: (_, result) => [{ type: 'text', text: result }],
      ...(intent.lookup ? { presentationMeta: (_, result) => ({ workagentLookupPart: { name, text: lookupPart(name, JSON.parse(result)) } }) } : {}),
    },
    async execute(args, exec) {
      if (exec.agent.id !== job.sessionId) throw new Error('session_not_bound');
      if (Object.keys(args).some(k => !Object.hasOwn(parameters, k))) throw new Error('unexpected_arguments');
      const check = async () => {
        exec.signal.throwIfAborted();
        await authorize(exec.agent.id);
        exec.signal.throwIfAborted();
      };
      await check();
      const read = publicReader({ open, signal: exec.signal, authorize: async () => {
        await check();
        if (++publicReads > 6) throw new Error('public_read_limit');
      } });
      const result = await run(args, read);
      await check();
      return JSON.stringify(result);
    },
  }));
  register('calculate', 'Use for arithmetic in chat. Bounded floating-point calculation, not a file or code executor.', {
    expression: { type: 'string', required: true, description: 'Up to 256 characters: decimal numbers, parentheses, unary signs and + - * /. Write percentages as /100.' },
  }, ({ expression }) => calculate(expression));
  if (intent.lookup) register('lookup_public', 'Search English Wikipedia for a public topic requested by the user. Returns untrusted excerpts and article links, not a general web search or URL reader. Cite relevant links. Never send private material.', {
    query: { type: 'string', required: true, description: 'Short public topic copied verbatim from the current request, not history or an attachment.' },
  }, (args, read) => lookupPublic(args, intent.lookup, read));
  const placeArgs = {
    location: { type: 'string', required: true, description: 'City or town copied verbatim from this request; not an address or inferred location.' },
    region: { type: 'string', description: 'Optional exact region or country name from this request.' },
  };
  if (intent.weather) register('current_weather', 'Get current Open-Meteo model conditions for a requested public place. Name the resolved location, valid UTC time and source. Ask for a region if ambiguous. Never infer current conditions from memory or report failed reads as weather.', placeArgs, (args, read) => currentWeather(args, intent.weather, read));
  if (intent.forecast) register('daily_forecast', 'Get a daily temperature forecast, not current conditions. Report the resolved location, local date and timezone, forecast low/high in °C and source.', {
    ...placeArgs, day: { type: 'string', required: true, enum: ['today', 'tomorrow'], description: 'Local day explicitly requested this turn.' },
  }, (args, read) => dailyForecast(args, intent.forecast, read));
}
