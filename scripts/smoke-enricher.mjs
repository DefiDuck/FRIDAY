// Smoke test for the provider dispatcher (Ollama path).
// Hits localhost:11434 directly, so Ollama must be running with phi3.5 pulled.

import { isProviderAvailable, enrichWithProvider } from '../dist/main/providers/index.js';

const config = { type: 'ollama', model: 'phi3.5' };

const available = await isProviderAvailable(config);
console.log(`isProviderAvailable(${config.type}, ${config.model}) =`, available);
if (!available) {
  console.log('Ollama not reachable or model not pulled. Run: ollama pull phi3.5');
  process.exit(1);
}

const notes = [
  // Classic synonym coverage — revenge, patient, waited-setup.
  "Got back at the market this morning. Took revenge on that loss. But I stayed patient and waited for the second setup before jumping in.",
  // Denial — should skip the revenge flag.
  "I did NOT revenge trade today. Closed ES when the thesis broke and moved on.",
  // Inverse rule: euphoric feeling is fine on its own; oversize is the behaviour.
  "Felt invincible after the NQ scalp. Sized way up on the next one and it went against me fast.",
  // Clean discipline day — should stay positive.
  "Journaled before open. Waited for the setup. Took the trade, got stopped, moved on.",

  // ── The Mask (Rule 1): pro language after losses = rationalization ────
  "Lost three in a row on ES. Still had high conviction on the last one, so I stuck to the plan and doubled my size. Bled out anyway.",

  // ── The Inverse Rule (Rule 2): euphoria + aggressive follow-through ────
  "Feeling euphoric after that NQ scalp. Can't wait to ride this momentum all afternoon — already scaling up on CL.",

  // ── The Gap (Rule 3): calm claim contradicts revenge action ────────────
  "Stayed completely calm today. Took revenge on the YM loss and loaded up to make it back.",

  // ── Mixed gap: 'disciplined' claim + added-to-loser action ─────────────
  "Stuck to my process all morning. When ES gapped against me I stayed disciplined and added at the low — averaged down my entry.",

  // ── Control: clean euphoria with NO aggressive action → stays positive ─
  "Felt elated after my daughter's recital last night. Slept well, came in calm, took one clean trade and walked away.",
];

for (const content of notes) {
  console.log('\n\u2500\u2500\u2500 note \u2500\u2500\u2500');
  console.log(content);
  console.log('\u2500 ai matches \u2500');
  const r = await enrichWithProvider(content, config);
  console.log(`  model=${r.model}  latency=${r.latencyMs}ms  matches=${r.matches.length}`);
  for (const m of r.matches) {
    const surface = content.slice(m.start, m.end);
    console.log(`    [${m.start}-${m.end}] "${surface}" \u2192 ${m.canonical} (${m.valence})${m.rationale ? ' \u2014 ' + m.rationale : ''}`);
  }
}
