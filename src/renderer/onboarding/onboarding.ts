// ── F.R.I.D.A.Y. Onboarding Wizard (4-step) ────────────────────────────────
// Five visual screens, four conceptual steps:
//   1 → Welcome           (s-welcome)
//   2 → Choose AI         (s-choose)
//   3 → Provider Setup    (s-setup)         + trading hours sub-section
//   4 → Try It Out        (s-try)
//   4 → Sample Briefing   (s-result)        ← same step number; result state
//
// Closing path:
//   • Generate → result screen → Finish      (settings written, sample saved)
//   • Skip      → Finish directly             (settings written, no sample)
//   • Provider error → result-error → Finish  (note still saved)

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

// ── Screen registry ───────────────────────────────────────────────────────
const screens = {
  welcome: $<HTMLDivElement>('s-welcome'),
  choose:  $<HTMLDivElement>('s-choose'),
  setup:   $<HTMLDivElement>('s-setup'),
  try:     $<HTMLDivElement>('s-try'),
  result:  $<HTMLDivElement>('s-result'),
};
type ScreenName = keyof typeof screens;

const stepNumEl = $<HTMLSpanElement>('step-num');

function showScreen(name: ScreenName): void {
  for (const s of Object.values(screens)) s.classList.remove('active');
  screens[name].classList.add('active');
  // Step indicator reflects each screen's data-step attribute. Result and
  // Try It Out both stamp 4 — the result is a sub-state of Step 4.
  const step = screens[name].dataset.step ?? '1';
  stepNumEl.textContent = step;
}

// ── Step 1: Welcome ───────────────────────────────────────────────────────
$('btn-start').addEventListener('click', () => showScreen('choose'));

// ── Step 2: Choose AI ─────────────────────────────────────────────────────
type ProviderType = 'ollama' | 'anthropic' | 'openai' | 'gemini' | 'none';

const defaultModels: Record<Exclude<ProviderType, 'none'>, string> = {
  ollama: 'phi3.5',
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
};

let selectedType: ProviderType | null = null;
const cards = document.querySelectorAll<HTMLDivElement>('.pcard');
const btnChooseNext = $<HTMLButtonElement>('btn-choose-next');

for (const card of cards) {
  card.addEventListener('click', () => {
    for (const c of cards) c.classList.remove('selected');
    card.classList.add('selected');
    selectedType = card.dataset.type as ProviderType;
    btnChooseNext.disabled = false;
  });
}

$('btn-choose-back').addEventListener('click', () => showScreen('welcome'));
btnChooseNext.addEventListener('click', () => {
  if (!selectedType) return;
  prepareSetupScreen(selectedType);
  showScreen('setup');
});

// ── Step 3: Provider Setup + Trading Hours ────────────────────────────────
const setupTitle  = $<HTMLHeadingElement>('setup-title');
const setupOllama = $<HTMLDivElement>('setup-ollama');
const setupApikey = $<HTMLDivElement>('setup-apikey');
const setupNone   = $<HTMLDivElement>('setup-none');
const btnSetupNext = $<HTMLButtonElement>('btn-setup-next');

const ollamaModel  = $<HTMLInputElement>('ollama-model');
const ollamaDot    = $<HTMLDivElement>('ollama-dot');
const ollamaStatus = $<HTMLSpanElement>('ollama-status');

const apikeyLabel  = $<HTMLSpanElement>('apikey-label');
const apikeyInput  = $<HTMLInputElement>('apikey-input');
const apikeyHelp   = $<HTMLDivElement>('apikey-help');
const apikeyDot    = $<HTMLDivElement>('apikey-dot');
const apikeyStatus = $<HTMLSpanElement>('apikey-status');

const tradingWake  = $<HTMLInputElement>('trading-wake');
const tradingEnd   = $<HTMLInputElement>('trading-end');

const providerNames: Record<ProviderType, string> = {
  ollama: 'Ollama',
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  none: 'Lexicon only',
};

const apikeyHints: Record<string, { placeholder: string; help: string }> = {
  anthropic: {
    placeholder: 'sk-ant-...',
    help: 'Get your key at console.anthropic.com/settings/keys',
  },
  openai: {
    placeholder: 'sk-...',
    help: 'Get your key at platform.openai.com/api-keys',
  },
  gemini: {
    placeholder: 'AIza...',
    help: 'Get your key at aistudio.google.com/apikey',
  },
};

function hideAllSetups(): void {
  setupOllama.hidden = true;
  setupApikey.hidden = true;
  setupNone.hidden = true;
}

function prepareSetupScreen(type: ProviderType): void {
  hideAllSetups();
  setupTitle.textContent = `Set up ${providerNames[type]}`;

  if (type === 'ollama') {
    setupOllama.hidden = false;
    ollamaDot.className = 'status-dot';
    ollamaStatus.textContent = 'Not checked yet';
    void checkOllama();
  } else if (type === 'none') {
    setupNone.hidden = false;
  } else {
    setupApikey.hidden = false;
    const hint = apikeyHints[type]!;
    apikeyLabel.textContent = `${providerNames[type]} API Key`;
    apikeyInput.placeholder = hint.placeholder;
    apikeyInput.value = '';
    apikeyHelp.textContent = hint.help;
    apikeyDot.className = 'status-dot';
    apikeyStatus.textContent = 'Enter your key above';
  }
}

async function checkOllama(): Promise<void> {
  const model = ollamaModel.value.trim() || 'phi3.5';
  ollamaDot.className = 'status-dot checking';
  ollamaStatus.textContent = 'Checking...';
  const ok = await window.friday.checkProvider({ type: 'ollama', model });
  if (ok) {
    ollamaDot.className = 'status-dot ok';
    ollamaStatus.textContent = `Connected — ${model} ready`;
  } else {
    ollamaDot.className = 'status-dot err';
    ollamaStatus.textContent = 'Not reachable. Is Ollama running?';
  }
}

$('btn-ollama-check').addEventListener('click', () => void checkOllama());

let keyCheckTimer: ReturnType<typeof setTimeout> | null = null;
apikeyInput.addEventListener('input', () => {
  if (keyCheckTimer) clearTimeout(keyCheckTimer);
  const val = apikeyInput.value.trim();
  if (val.length < 4) {
    apikeyDot.className = 'status-dot';
    apikeyStatus.textContent = 'Enter your key above';
    return;
  }
  apikeyDot.className = 'status-dot checking';
  apikeyStatus.textContent = 'Validating...';
  keyCheckTimer = setTimeout(() => void validateApiKey(val), 400);
});

async function validateApiKey(key: string): Promise<void> {
  if (!selectedType || selectedType === 'ollama' || selectedType === 'none') return;
  const config = {
    type: selectedType,
    apiKey: key,
    model: defaultModels[selectedType],
  };
  const ok = await window.friday.checkProvider(config);
  if (ok) {
    apikeyDot.className = 'status-dot ok';
    apikeyStatus.textContent = 'Key accepted';
  } else {
    apikeyDot.className = 'status-dot err';
    apikeyStatus.textContent = 'Could not verify — check the key';
  }
}

$('btn-setup-back').addEventListener('click', () => showScreen('choose'));

// "Continue" from Step 3 persists provider + trading hours immediately
// (so the IPC handler in Step 4 reads the freshly-saved provider when
// generating the sample). onboardingComplete is left false until the
// user reaches the final Finish — they can still close the wizard
// mid-flow without trapping themselves into a "done" state.
btnSetupNext.addEventListener('click', () => void enterTryStep());

async function enterTryStep(): Promise<void> {
  if (!selectedType) return;
  btnSetupNext.disabled = true;
  btnSetupNext.textContent = 'Saving…';
  await persistProviderAndHours();
  btnSetupNext.disabled = false;
  btnSetupNext.textContent = 'Continue';
  showScreen('try');
  // Autofocus the textarea — AC #2.
  setTimeout(() => tryInput.focus(), 60);
}

function buildProviderPayload(): Record<string, unknown> {
  if (selectedType === 'none' || selectedType === null) {
    return { type: 'none' };
  }
  if (selectedType === 'ollama') {
    return {
      type: 'ollama',
      model: ollamaModel.value.trim() || 'phi3.5',
    };
  }
  return {
    type: selectedType,
    apiKey: apikeyInput.value.trim(),
    model: defaultModels[selectedType],
  };
}

async function persistProviderAndHours(): Promise<void> {
  const partial: Partial<RendererSettings> = {
    provider: buildProviderPayload() as RendererSettings['provider'],
    wakeTime: tradingWake.value || '06:30',
    sessionEndTime: tradingEnd.value || '16:00',
  };
  await window.friday.updateSettings(partial);
}

// ── Step 4: Try It Out ────────────────────────────────────────────────────
const tryInput        = $<HTMLTextAreaElement>('try-input');
const btnTrySkip      = $<HTMLButtonElement>('btn-try-skip');
const btnTryGenerate  = $<HTMLButtonElement>('btn-try-generate');
const genStatus       = $<HTMLDivElement>('gen-status');
const genStatusText   = $<HTMLSpanElement>('gen-status-text');

btnTrySkip.addEventListener('click', () => void handleSkip());
btnTryGenerate.addEventListener('click', () => void handleGenerate());

async function handleSkip(): Promise<void> {
  // Mark as skipped (hint for future re-engagement) and finish.
  await finalizeOnboarding({ skippedSampleBriefing: true });
  await window.friday.closeWindow();
}

async function handleGenerate(): Promise<void> {
  const content = tryInput.value.trim();
  if (content.length < 3) {
    tryInput.focus();
    return;
  }

  // Lock UI during the request — disabling the textarea + the buttons.
  tryInput.disabled = true;
  btnTryGenerate.disabled = true;
  btnTrySkip.disabled = true;

  // Spinner + progress copy. The text adapts to the provider so the user
  // knows what they're waiting on (and roughly how long).
  genStatus.classList.remove('hidden');
  genStatusText.textContent = providerWaitMessage();

  let result: RendererSampleBriefingResult;
  try {
    result = await window.friday.generateSampleBriefing(content);
  } catch (err) {
    result = {
      ok: false,
      noteId: '',
      error: (err as Error)?.message ?? 'Unknown failure',
    };
  }

  genStatus.classList.add('hidden');
  // Re-enable the textarea/buttons in case the user comes back somehow,
  // though the screen transitions immediately so they shouldn't see this.
  tryInput.disabled = false;
  btnTryGenerate.disabled = false;
  btnTrySkip.disabled = false;

  renderSampleBriefing(result);
  showScreen('result');
}

function providerWaitMessage(): string {
  const model = selectedType === 'ollama'
    ? (ollamaModel.value.trim() || 'phi3.5')
    : selectedType && selectedType !== 'none'
      ? defaultModels[selectedType]
      : 'lexicon';
  if (selectedType === 'ollama') {
    return `Analyzing your note with ${model}… (the morning briefing will feel like this, but faster after warmup)`;
  }
  if (selectedType === 'none') {
    return 'Running pattern detection…';
  }
  return `Analyzing your note with ${model}…`;
}

// ── Step 4 result: render the sample briefing or fallback ─────────────────
const briefingCard       = $<HTMLDivElement>('briefing-card');
const resultHeading      = $<HTMLHeadingElement>('result-heading');
const resultBody         = $<HTMLDivElement>('result-body');
const resultDivider      = $<HTMLHRElement>('result-divider');
const resultTomorrow     = $<HTMLDivElement>('result-tomorrow');
const resultTomorrowTime = $<HTMLSpanElement>('result-tomorrow-time');
const btnResultFinish    = $<HTMLButtonElement>('btn-result-finish');

function renderSampleBriefing(result: RendererSampleBriefingResult): void {
  // Reset to the success-shaped DOM each time.
  resultHeading.textContent = 'Your sample briefing';
  resultDivider.style.display = '';
  resultTomorrow.style.display = '';
  resultTomorrowTime.textContent = tradingWake.value || '06:30';

  if (!result.ok) {
    // §3.5 error fallback. Note is preserved server-side; user can still finish.
    resultHeading.textContent = 'Your sample briefing';
    resultBody.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'briefing-empty';
    const providerLabel = selectedType ? providerNames[selectedType] : 'your AI';
    msg.textContent =
      `Couldn’t reach ${providerLabel} right now. Your note was saved — ` +
      `tomorrow morning’s briefing will retry automatically.`;
    resultBody.appendChild(msg);
    resultDivider.style.display = 'none';
    resultTomorrow.style.display = 'none';
    return;
  }

  // OK branch — patterns may be empty.
  if (result.patterns.length === 0) {
    resultBody.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'briefing-empty';
    msg.innerHTML =
      'No patterns detected in this note — that’s fine.<br><br>' +
      'As you write more, F.R.I.D.A.Y. learns your lexicon and surfaces patterns over time.';
    resultBody.appendChild(msg);
    return;
  }

  resultBody.innerHTML = '';
  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;';
  heading.textContent = 'Patterns detected in your note';
  resultBody.appendChild(heading);

  for (const p of result.patterns) {
    const row = document.createElement('div');
    row.className = 'pattern-row';

    const dot = document.createElement('div');
    dot.className = `dot ${p.valence === 'positive' ? 'pos' : 'neg'}`;
    row.appendChild(dot);

    const text = document.createElement('div');
    const label = document.createElement('span');
    label.className = `label ${p.valence === 'positive' ? 'pos' : 'neg'}`;
    label.textContent = `${p.valence === 'positive' ? 'Strength' : 'Concern'}: ${p.canonical}`;
    text.appendChild(label);
    text.appendChild(document.createTextNode('  '));
    const matched = document.createElement('span');
    matched.className = 'matched';
    matched.textContent = `(matched “${p.matched}”)`;
    text.appendChild(matched);
    row.appendChild(text);

    const srcTag = document.createElement('span');
    srcTag.className = 'src-tag';
    srcTag.textContent = p.source === 'ai' ? 'AI' : 'Lex';
    row.appendChild(srcTag);

    resultBody.appendChild(row);
  }
}

btnResultFinish.addEventListener('click', () => void handleFinishFromResult());

async function handleFinishFromResult(): Promise<void> {
  btnResultFinish.disabled = true;
  btnResultFinish.textContent = 'Saving…';
  await finalizeOnboarding({});
  await window.friday.closeWindow();
}

async function finalizeOnboarding(extra: Partial<RendererSettings>): Promise<void> {
  // Re-send the provider+hours payload along with onboardingComplete=true.
  // updateSettings is idempotent against the keyRef migration in v0.1.1,
  // so re-sending an already-migrated provider is a no-op.
  const partial: Partial<RendererSettings> = {
    provider: buildProviderPayload() as RendererSettings['provider'],
    wakeTime: tradingWake.value || '06:30',
    sessionEndTime: tradingEnd.value || '16:00',
    onboardingComplete: true,
    ...extra,
  };
  await window.friday.updateSettings(partial);
}

// Suppress accidental "unused" warning in some lint configs — referenced
// via the onclick wiring above.
void briefingCard;

// ── Keyboard ──────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    void window.friday.closeWindow();
  }
});
