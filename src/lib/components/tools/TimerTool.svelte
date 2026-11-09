<script lang="ts">
  import { onMount } from "svelte";
  import {
    timerState, pomodoroConfig, soundConfig,
    startStop as startStopTimer, reset, lap, setMode, setCountdownTarget, skipPomodoro,
    requestNotificationPermission,
    currentSeconds, currentTotal, formatTime, formatMs, formatLapMs,
    swTotalMs, swLapMs, todayFocusSeconds, buildBreakPattern,
    restoreTimerLocal, setPomodoroRemaining, MAX_POMO_MINUTES, MAX_COUNTDOWN_SECONDS,
    type TimerMode, type PomodoroPhase, type BreakType,
  } from "$lib/stores/timerState.svelte";
  import {
    pomoTasks, pomoMeta,
    addTask, removeTask, toggleDone, setActive, setEstimated,
  } from "$lib/stores/pomodoroTasks.svelte";

  // Starting a timer is the moment the permission prompt makes sense — the user has just
  // signalled they intend to leave this tab alone for a while.
  function startStop() {
    if (!timerState.running) requestNotificationPermission();
    startStopTimer();
  }

  // ── Progress (countdown / pomodoro) ──────────────────────────────
  const progress = $derived(() => {
    const total = currentTotal();
    if (total === 0) return 0;
    return 1 - currentSeconds() / total;
  });

  // ── Stopwatch RAF display ─────────────────────────────────────────
  let displayTotalMs = $state(0);
  let displayLapMs   = $state(0);
  let rafId = 0;

  $effect(() => {
    const active = timerState.mode === "stopwatch" && timerState.running;
    if (!active) {
      cancelAnimationFrame(rafId);
      displayTotalMs = swTotalMs();
      displayLapMs   = swLapMs();
      return;
    }
    function frame() {
      displayTotalMs = swTotalMs();
      displayLapMs   = swLapMs();
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  });

  // ── Toast notification ────────────────────────────────────────────
  let toastMsg   = $state("");
  let toastVisible = $state(false);
  let _toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(msg: string) {
    toastMsg = msg;
    toastVisible = true;
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { toastVisible = false; }, 3500);
  }

  // ── Detect pomodoro work session completion → toast ───────────────
  let _prevLogLen = timerState.sessionLog.length;
  $effect(() => {
    const log = timerState.sessionLog;
    if (log.length > _prevLogLen) {
      const newest = log[0];
      if (newest.mode === "pomodoro" && newest.label.startsWith("Work")) {
        const midnight = new Date(); midnight.setHours(0,0,0,0);
        const todayCount = log.filter(
          (e) => e.ts >= midnight.getTime() && e.mode === "pomodoro" && e.label.startsWith("Work")
        ).length;
        showToast(`${newest.label} done · ${todayCount} today`);
      }
      _prevLogLen = log.length;
    }
  });

  // ── Active task derived ───────────────────────────────────────────
  const activeTask = $derived(() => pomoTasks.find((t) => t.id === pomoMeta.activeTaskId) ?? null);

  // ── Focus without scroll ──────────────────────────────────────────
  function focusNoScroll(node: HTMLInputElement) {
    node.focus({ preventScroll: true });
  }

  // ── Countdown editing ─────────────────────────────────────────────
  let editingCountdown = $state(false);
  let cdHours   = $state("0");
  let cdMinutes = $state("25");
  let cdSeconds = $state("0");
  let hoursInput:   HTMLInputElement | null = $state(null);
  let minutesInput: HTMLInputElement | null = $state(null);
  let secondsInput: HTMLInputElement | null = $state(null);
  let cdOpenedAt = 0; // seconds showing when the editor opened, so dismissing it changes nothing

  function openCountdownEdit() {
    if (timerState.running) return;
    if (timerState.mode !== "countdown" && timerState.mode !== "pomodoro") return;
    const t = currentSeconds(); // remaining seconds for either mode
    cdHours   = String(Math.floor(t / 3600));
    cdMinutes = String(Math.floor((t % 3600) / 60));
    cdSeconds = String(t % 60);
    cdOpenedAt = t;
    editingCountdown = true;
  }

  function applyCountdownEdit() {
    if (!editingCountdown) return; // removing the focused input fires focusout after Enter/Esc
    editingCountdown = false;
    const h = Math.max(0, parseInt(cdHours)   || 0);
    const m = Math.max(0, parseInt(cdMinutes) || 0);
    const s = Math.min(59, Math.max(0, parseInt(cdSeconds) || 0));
    const secs = Math.min(MAX_COUNTDOWN_SECONDS, h * 3600 + m * 60 + s);
    if (secs <= 0 || secs === cdOpenedAt) return;
    if (timerState.mode === "pomodoro") {
      // The clock only moves within this phase; its length is set in the settings row.
      if (secs > currentTotal()) { showToast(`This phase is only ${currentTotal() / 60}m long`); return; }
      setPomodoroRemaining(secs);
    } else {
      setCountdownTarget(secs);
    }
  }

  function clampSeconds() {
    cdSeconds = String(Math.min(59, Math.max(0, parseInt(cdSeconds) || 0)));
  }

  function onlyDigits(e: Event) {
    const el = e.target as HTMLInputElement;
    el.value = el.value.replace(/\D/g, "");
  }

  function onEditKey(e: KeyboardEvent, prev: HTMLInputElement | null, next: HTMLInputElement | null) {
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === "ArrowRight" && el.selectionStart === el.value.length && next) {
      e.preventDefault(); next.focus(); next.setSelectionRange(0, 0);
    }
    if (e.key === "ArrowLeft" && el.selectionStart === 0 && prev) {
      e.preventDefault(); prev.focus(); prev.setSelectionRange(prev.value.length, prev.value.length);
    }
    if (e.key === "Enter") applyCountdownEdit();
    if (e.key === "Escape") editingCountdown = false;
  }

  // ── Pomodoro editing ──────────────────────────────────────────────
  let editingPomoField = $state<"work" | "short" | "long" | "rounds" | null>(null);
  let pomoEditVal = $state("");

  function startPomoEdit(field: "work" | "short" | "long" | "rounds") {
    if (timerState.running) return;
    if (field === "rounds") pomoEditVal = String(pomodoroConfig.breakPattern.length);
    else {
      const map = { work: pomodoroConfig.workDuration, short: pomodoroConfig.shortBreak, long: pomodoroConfig.longBreak };
      pomoEditVal = String(map[field] / 60);
    }
    editingPomoField = field;
  }

  function applyPomoEdit() {
    const field = editingPomoField;
    if (!field) return;
    const val = parseInt(pomoEditVal);
    let changed = false;
    if (!isNaN(val) && val > 0) {
      if (field === "rounds") {
        // resize pattern, preserving existing break types, always end with long-break
        const next = buildBreakPattern(val, pomodoroConfig.breakPattern);
        changed = next.length !== pomodoroConfig.breakPattern.length;
        if (changed) pomodoroConfig.breakPattern = next;
      } else {
        const key = field === "work" ? "workDuration" : field === "short" ? "shortBreak" : "longBreak";
        const mins = Math.min(val, MAX_POMO_MINUTES);
        if (mins !== val) showToast(`Capped at ${MAX_POMO_MINUTES} minutes`);
        changed = pomodoroConfig[key] !== mins * 60;
        pomodoroConfig[key] = mins * 60;
      }
    }
    editingPomoField = null;
    if (changed) reset(); // opening a field and clicking away must not lose paused progress
  }

  const breakCycle: BreakType[] = ['short-break', 'long-break', 'no-break'];

  function toggleBreakType(i: number) {
    if (timerState.running) return;
    const p = pomodoroConfig.breakPattern;
    const idx = breakCycle.indexOf(p[i]);
    p[i] = breakCycle[(idx + 1) % breakCycle.length];
    // Only the break being sat in right now is affected; later slots just change the plan.
    if (i === timerState.pomodoroSession - 1 && timerState.pomodoroPhase !== "work") reset();
  }

  // ── Task list state ───────────────────────────────────────────────
  let newTaskText = $state("");
  let editingEstId = $state<number | null>(null);
  let editEstVal   = $state(1);

  function submitTask() {
    addTask(newTaskText);
    newTaskText = "";
  }

  function openEstEdit(task: { id: number; estimated: number }) {
    editingEstId = task.id;
    editEstVal   = task.estimated;
  }

  function applyEstEdit() {
    if (editingEstId !== null) setEstimated(editingEstId, editEstVal);
    editingEstId = null;
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────
  let rootEl: HTMLDivElement | null = $state(null);
  let logEl: HTMLDetailsElement | null = $state(null);

  function onDocPointer(e: PointerEvent) {
    if (logEl?.open && !logEl.contains(e.target as Node)) logEl.open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    // The timer stays mounted inside a closed (inert) side panel.
    if (rootEl?.closest("[inert]")) return;
    if (e.key === "Escape" && logEl?.open) {
      logEl.open = false;
      logEl.querySelector("summary")?.focus();
      return;
    }
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
    if (e.code === "Space") {
      // A focused control owns Space: it activates that control, not the timer.
      if (el.matches("button, a[href], summary, [role], [tabindex]")) return;
      e.preventDefault();
      if (!e.repeat) startStop();
    }
    if (e.repeat) return;
    if (e.code === "KeyR") reset();
    if (e.code === "KeyL") lap();
  }

  // A mouse click leaves focus on the button, where Space would then re-press it instead of
  // reaching the Space shortcut. Keyboard activation has detail 0 and keeps its focus.
  function releaseMouseFocus(e: MouseEvent) {
    if (e.detail === 0) return;
    const control = (e.target as HTMLElement).closest("button, summary");
    if (control && control === document.activeElement) (control as HTMLElement).blur();
  }

  onMount(() => {
    // After hydration, so the first render matches the server's HTML.
    restoreTimerLocal();
    _prevLogLen = timerState.sessionLog.length; // restored sessions aren't new completions
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDocPointer);
    rootEl?.addEventListener("click", releaseMouseFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocPointer);
      rootEl?.removeEventListener("click", releaseMouseFocus);
    };
  });

  // ── Presets ───────────────────────────────────────────────────────
  const presets = [
    { label: "5m",  secs: 5 * 60 },
    { label: "10m", secs: 10 * 60 },
    { label: "25m", secs: 25 * 60 },
    { label: "45m", secs: 45 * 60 },
    { label: "1h",  secs: 60 * 60 },
  ];

  // ── Pomodoro colors / labels ──────────────────────────────────────
  const phaseColor: Record<string, string> = {
    work: "var(--color-accent)", "short-break": "var(--tag-2-fg)", "long-break": "var(--tag-1-fg)",
  };
  const phaseLabel: Record<string, string> = {
    work: "Focus", "short-break": "Short Break", "long-break": "Long Break",
  };

  // Phase colours are CSS variables, so opacity has to be mixed in
  const tint = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

  const accentColor = $derived(() =>
    timerState.mode === "pomodoro" ? phaseColor[timerState.pomodoroPhase] : "var(--color-accent)"
  );

  // Rectangle border + tint based on phase
  const rectStyle = $derived(() => {
    if (timerState.mode !== "pomodoro") return "";
    const c = phaseColor[timerState.pomodoroPhase];
    return `border-color: ${tint(c, 31)}; background: color-mix(in srgb, ${c} 4%, var(--color-bg-surface))`;
  });

  // ── Lap stats ─────────────────────────────────────────────────────
  const fastestIdx = $derived(() => {
    // Needs at least two laps — a lone lap is neither fastest nor slowest.
    if (timerState.laps.length < 2) return -1;
    return timerState.laps.reduce((b, l, i) => l.lapTime < timerState.laps[b].lapTime ? i : b, 0);
  });
  const slowestIdx = $derived(() => {
    if (timerState.laps.length < 2) return -1;
    return timerState.laps.reduce((w, l, i) => l.lapTime > timerState.laps[w].lapTime ? i : w, 0);
  });
  const bestLapMs = $derived(() => fastestIdx() >= 0 ? timerState.laps[fastestIdx()].lapTime : 0);

  const modes: TimerMode[] = ["countdown", "stopwatch", "pomodoro"];

  // Is there anything below the controls? Drives whether the block centres itself.
  const hasLowerContent = $derived(() =>
    timerState.mode === "pomodoro" ||
    (timerState.mode === "stopwatch" && timerState.laps.length > 0)
  );

  // Countdown and pomodoro only; the stopwatch has its own three-state button row.
  const startLabel = $derived(() => {
    if (timerState.running) return "Pause";
    if (timerState.mode === "pomodoro" && timerState.waitingForNext) return "Next";
    const banked = timerState.mode === "pomodoro" ? timerState.pomodoroElapsed : timerState.elapsed;
    return banked > 0 ? "Resume" : "Start";
  });

  const pomoFields = [
    { key: "work"  as const, label: "Work",  get: () => pomodoroConfig.workDuration / 60 },
    { key: "short" as const, label: "Short", get: () => pomodoroConfig.shortBreak / 60 },
    { key: "long"  as const, label: "Long",  get: () => pomodoroConfig.longBreak / 60 },
  ];

  const inputClass =
    "w-16 bg-transparent outline-none text-center font-extrabold text-[2.6rem] " +
    "text-text-primary border-b-2 border-accent-timer pb-1 appearance-none " +
    "[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

  // Stopwatch state helpers
  const swIdle    = $derived(() => timerState.mode === "stopwatch" && !timerState.running && timerState.accMs === 0);
  const swRunning = $derived(() => timerState.mode === "stopwatch" && timerState.running);
  const swPaused  = $derived(() => timerState.mode === "stopwatch" && !timerState.running && timerState.accMs > 0);

  // Today's completed pomodoros (from session log)
  const todayPomos = $derived(() => {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    return timerState.sessionLog.filter(
      (e) => e.ts >= midnight.getTime() && e.mode === "pomodoro" && e.label.startsWith("Work")
    ).length;
  });
</script>

<div bind:this={rootEl} class="timer-root flex flex-col h-full select-none overflow-hidden">

  <!-- ── Mode tabs ──────────────────────────────────────────────── -->
  <div class="flex shrink-0 border-b border-border-default bg-bg-panel">
    {#each modes as m}
      <button
        onclick={() => setMode(m)}
        class="relative flex-1 py-3.5 text-[0.68rem] font-semibold tracking-[0.15em] uppercase
               transition-colors duration-150 cursor-pointer focus-visible:-outline-offset-2
               {timerState.mode === m ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'}"
      >
        {m}
        {#if timerState.mode === m}
          <span class="absolute bottom-0 left-1/4 right-1/4 h-[2px] bg-accent-timer rounded-t-full"></span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- ── Main content ───────────────────────────────────────────── -->
  <!-- With nothing below the controls (countdown, or a stopwatch with no laps yet) the
       block centres itself rather than hugging the top of an empty column. -->
  <div class="relative flex flex-col flex-1 overflow-hidden {hasLowerContent() ? '' : 'justify-center'}">

    <!-- Session completion toast -->
    <div
      class="absolute bottom-3 left-1/2 z-30 pointer-events-none
             flex items-center gap-2 px-4 py-2 rounded-xl border text-[0.72rem] font-medium
             transition-all duration-300 whitespace-nowrap"
      style="background:color-mix(in srgb, {phaseColor['work']} 7%, var(--color-bg-surface)); border-color:{tint(phaseColor['work'], 19)}; color:{phaseColor['work']};
             opacity:{toastVisible ? 1 : 0}; transform:translate(-50%, {toastVisible ? '0' : '8px'})"
    >
      <span style="opacity:0.75">🍅</span>
      {toastMsg}
    </div>

  <!-- ── Fixed top: timer + controls (always visible) ──────────── -->
  <div class="shrink-0 flex flex-col items-center gap-5 px-8 pt-6 pb-4">

    <!-- Pomodoro phase badge + session dots -->
    {#if timerState.mode === "pomodoro"}
      <div class="flex items-center gap-3">
        <span
          class="px-2.5 py-0.5 rounded-full text-[0.65rem] font-semibold tracking-widest uppercase transition-all duration-500"
          style="color:{phaseColor[timerState.pomodoroPhase]}; background:{tint(phaseColor[timerState.pomodoroPhase], 13)}"
        >{phaseLabel[timerState.pomodoroPhase]}</span>
        <span class="text-text-muted text-[0.7rem]">#{timerState.pomodoroSession}</span>
        <!-- Cycle dots -->
        <div class="flex gap-1.5 items-center">
          {#each pomodoroConfig.breakPattern as _, i}
            {@const isDone = i < timerState.pomodoroSession - 1}
            {@const isCurrent = i === timerState.pomodoroSession - 1 && timerState.pomodoroPhase === 'work'}
            <div
              class="rounded-full transition-all duration-300 {isCurrent ? 'w-2 h-2 ring-2 ring-offset-1 ring-offset-bg-panel' : 'w-1.5 h-1.5'}"
              style="background:{isDone || isCurrent ? phaseColor['work'] : 'var(--color-border-default)'}; {isCurrent ? `--tw-ring-color:${phaseColor['work']}` : ''}"
            ></div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- ── Time rectangle ────────────────────────────────────────── -->
    <div
      class="w-full max-w-[380px] rounded-[20px] overflow-hidden border border-border-default bg-bg-panel transition-all duration-500"
      style={rectStyle()}
    >
      <div class="px-10 pt-9 pb-6 flex flex-col items-center gap-3">

        {#if timerState.mode === "stopwatch"}
          <!-- ── Stopwatch face ──────────────────────────────────── -->
          <div class="flex flex-col items-center gap-2">
            <span class="font-extrabold text-[2.6rem] leading-none tracking-tight text-text-primary tabular-nums">
              {formatMs(displayTotalMs)}
            </span>
            <div class="flex items-center gap-2 text-[0.75rem]">
              <span class="text-text-muted">Lap {timerState.laps.length + 1}</span>
              <span style="color:var(--color-border-default)">·</span>
              <span class="text-text-secondary tabular-nums">{formatLapMs(displayLapMs)}</span>
            </div>
          </div>

        {:else if editingCountdown}
          <!-- ── Countdown editor ────────────────────────────────── -->
          <div
            class="flex flex-col items-center gap-2"
            onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) applyCountdownEdit(); }}
          >
            <div class="flex items-center gap-1.5">
              <input type="text" inputmode="numeric" bind:value={cdHours}   bind:this={hoursInput}
                maxlength="2" oninput={onlyDigits} onkeydown={(e) => onEditKey(e, null, minutesInput)} class={inputClass} use:focusNoScroll />
              <span class="text-[2.6rem] font-semibold text-text-muted leading-none">:</span>
              <input type="text" inputmode="numeric" bind:value={cdMinutes} bind:this={minutesInput}
                maxlength="2" oninput={onlyDigits} onkeydown={(e) => onEditKey(e, hoursInput, secondsInput)} class={inputClass} />
              <span class="text-[2.6rem] font-semibold text-text-muted leading-none">:</span>
              <input type="text" inputmode="numeric" bind:value={cdSeconds} bind:this={secondsInput}
                maxlength="2" oninput={onlyDigits} onblur={clampSeconds} onkeydown={(e) => onEditKey(e, minutesInput, null)} class={inputClass} />
            </div>
            <span class="text-[0.58rem] text-text-muted tracking-[0.2em] uppercase">Enter or click outside to set</span>
          </div>

        {:else}
          <!-- ── Countdown / Pomodoro face ──────────────────────── -->
          <div class="flex flex-col items-center gap-1.5">
            <button
              class="font-extrabold leading-none tracking-tight text-[2.6rem] transition-all duration-150
                     {timerState.finished ? 'text-accent-timer' : 'text-text-primary'}
                     {(timerState.mode === 'countdown' || timerState.mode === 'pomodoro') && !timerState.running ? 'cursor-pointer hover:text-accent-timer' : 'cursor-default'}"
              onclick={openCountdownEdit}
              disabled={timerState.running}
            >{formatTime(currentSeconds())}</button>

            {#if (timerState.mode === "countdown" || timerState.mode === "pomodoro") && !timerState.running && !timerState.finished}
              <span class="text-[0.58rem] text-text-muted tracking-[0.2em] uppercase">HH : MM : SS — click to edit</span>
            {/if}
            {#if timerState.finished}
              <span class="text-[0.65rem] text-accent-timer tracking-widest uppercase animate-pulse">Done</span>
            {/if}

            <!-- Active task (pomodoro) -->
            {#if timerState.mode === "pomodoro" && activeTask()}
              {@const t = activeTask()!}
              <div class="flex items-center gap-2 mt-1 max-w-[260px]">
                <span class="text-[0.7rem] text-text-secondary truncate">{t.text}</span>
                <span class="text-[0.65rem] shrink-0 tabular-nums"
                  style="color:{phaseColor[timerState.pomodoroPhase]}"
                >{t.completed}/{t.estimated}</span>
              </div>
            {:else if timerState.mode === "pomodoro" && !activeTask()}
              <span class="text-[0.62rem] text-text-muted mt-1">— select a task below —</span>
            {/if}
          </div>
        {/if}

      </div>

      <!-- Progress bar -->
      <div class="px-8 pb-5">
        <div class="h-[3px] bg-border-default rounded-full overflow-hidden">
          {#if timerState.mode === "stopwatch"}
            {#if bestLapMs() > 0}
              {@const pct = Math.min(100, (displayLapMs / bestLapMs()) * 100)}
              <div class="h-full rounded-full transition-none"
                style="width:{pct}%; background:{pct >= 100 ? 'var(--tag-1-fg)' : 'var(--color-accent)'}"></div>
            {:else}
              <div class="h-full w-full rounded-full bg-accent-timer transition-opacity duration-300"
                style="opacity:{timerState.running ? 0.5 : 0.15}"></div>
            {/if}
          {:else}
            <div class="h-full rounded-full"
              style="width:{(1 - progress()) * 100}%; background:{accentColor()}; transition:width 0.95s linear,background 0.5s ease"></div>
          {/if}
        </div>
      </div>
    </div>

    <!-- ── Presets (countdown only) ──────────────────────────────── -->
    {#if timerState.mode === "countdown" && !timerState.running && !timerState.finished}
      <div class="preset-row flex gap-2">
        {#each presets as p}
          <button
            onclick={() => setCountdownTarget(p.secs)}
            class="hit min-w-[48px] px-4 py-2.5 text-[0.7rem] font-semibold rounded-lg border transition-all duration-150 cursor-pointer
                   {timerState.countdownTarget === p.secs
                     ? 'bg-accent-timer/10 border-accent-timer text-accent-timer'
                     : 'border-border-default text-text-muted hover:text-text-secondary hover:bg-bg-hover'}"
          >{p.label}</button>
        {/each}
      </div>
    {/if}

    <!-- Pomodoro waiting hint -->
    {#if timerState.mode === "pomodoro" && timerState.waitingForNext}
      <p class="text-[0.7rem] text-text-muted tracking-wide">
        {timerState.pomodoroPhase === 'work' ? 'Ready to focus?' : 'Session done — take a break'}
      </p>
    {/if}

    <!-- ── Controls ─────────────────────────────────────────────── -->
    {#if timerState.mode === "stopwatch"}
      <div class="action-row flex items-center gap-4">
        {#if swIdle()}
          <button disabled class="flex items-center justify-center px-6 py-3.5 text-[0.78rem] font-semibold rounded-xl border border-border-subtle text-text-muted opacity-40 cursor-not-allowed">Reset</button>
          <button onclick={startStop} class="flex items-center gap-2.5 px-9 py-4 text-[0.82rem] font-semibold rounded-xl bg-accent-timer border border-accent-timer text-on-accent hover:opacity-90 cursor-pointer shadow-lg transition-all duration-150 min-w-[120px] justify-center">
            Start <kbd class="text-[0.6rem] bg-on-accent/15 px-1.5 py-0.5 rounded">Space</kbd>
          </button>
        {:else if swRunning()}
          <button onclick={lap} class="flex items-center gap-2 px-6 py-3.5 text-[0.78rem] font-semibold rounded-xl border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-hover cursor-pointer transition-all duration-150">
            Lap <kbd class="text-[0.6rem] text-text-muted bg-bg-hover px-1.5 py-0.5 rounded">L</kbd>
          </button>
          <button onclick={startStop} class="flex items-center gap-2.5 px-9 py-4 text-[0.82rem] font-semibold rounded-xl bg-bg-surface border border-border-default text-text-primary hover:bg-bg-hover cursor-pointer transition-all duration-150 min-w-[120px] justify-center">
            Stop <kbd class="text-[0.6rem] bg-bg-hover px-1.5 py-0.5 rounded">Space</kbd>
          </button>
        {:else}
          <button onclick={reset} class="flex items-center gap-2 justify-center px-6 py-3.5 text-[0.78rem] font-semibold rounded-xl border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-hover cursor-pointer transition-all duration-150">
            Reset <kbd class="text-[0.6rem] text-text-muted bg-bg-hover px-1.5 py-0.5 rounded">R</kbd>
          </button>
          <button onclick={startStop} class="flex items-center gap-2.5 px-9 py-4 text-[0.82rem] font-semibold rounded-xl bg-accent-timer border border-accent-timer text-on-accent hover:opacity-90 cursor-pointer shadow-lg transition-all duration-150 min-w-[120px] justify-center">
            Resume <kbd class="text-[0.6rem] bg-on-accent/15 px-1.5 py-0.5 rounded">Space</kbd>
          </button>
        {/if}
      </div>

    {:else}
      <div class="action-row flex items-center gap-4">
        <button onclick={startStop} disabled={timerState.finished}
          class="flex items-center gap-2.5 px-9 py-4 text-[0.82rem] font-semibold rounded-xl border
                 transition-all duration-150 min-w-[130px] justify-center
                 {timerState.finished
                   ? 'border-border-default text-text-muted opacity-40 cursor-not-allowed'
                   : timerState.running
                     ? 'bg-bg-surface border-border-default text-text-primary hover:bg-bg-hover cursor-pointer'
                     : 'border-accent-timer text-on-accent hover:opacity-90 cursor-pointer shadow-lg'}"
          style={!timerState.finished && !timerState.running ? `background:${accentColor()}; border-color:${accentColor()}` : ''}
        >
          {startLabel()}
          <kbd class="text-[0.6rem] bg-current/15 px-1.5 py-0.5 rounded">Space</kbd>
        </button>
        <button onclick={reset} class="flex items-center gap-2 justify-center px-6 py-3.5 text-[0.78rem] font-semibold rounded-xl border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all duration-150 cursor-pointer">
          Reset <kbd class="text-[0.6rem] text-text-muted bg-bg-hover px-1.5 py-0.5 rounded">R</kbd>
        </button>
        {#if timerState.mode === "pomodoro"}
          <button onclick={skipPomodoro} class="px-6 py-3.5 text-[0.78rem] font-semibold rounded-xl border border-border-default text-text-muted hover:text-text-primary hover:bg-bg-hover transition-all duration-150 cursor-pointer">
            Skip ›
          </button>
        {/if}
      </div>
    {/if}

  </div><!-- end fixed top -->

  <!-- ── Scrollable bottom: config + planner + tasks + laps ─────── -->
  <div class="{hasLowerContent() ? 'flex-1 overflow-y-auto' : ''} flex flex-col items-center gap-5 px-8 pb-6">

    <!-- ── Pomodoro config ───────────────────────────────────────── -->
    {#if timerState.mode === "pomodoro"}
      <div class="pomo-config flex items-center gap-1 p-1 bg-bg-surface rounded-xl border border-border-subtle">
        <label class="hit flex items-center gap-2 px-3 py-2 cursor-pointer text-[0.7rem] text-text-muted hover:text-text-secondary transition-colors rounded-lg hover:bg-bg-hover">
          <input type="checkbox" bind:checked={pomodoroConfig.autoAdvance} class="accent-accent-timer cursor-pointer w-3 h-3" />
          Auto
        </label>
        <div class="w-px h-5 bg-border-subtle"></div>
        {#each pomoFields as f, fi}
          <div class="flex items-center gap-1 px-3 py-2 text-[0.7rem] text-text-muted">
            <span>{f.label}:</span>
            {#if editingPomoField === f.key}
              <input class="w-7 bg-transparent border-b border-accent-timer outline-none text-text-primary text-[0.7rem] text-center"
                bind:value={pomoEditVal} oninput={onlyDigits} onblur={applyPomoEdit}
                onkeydown={(e) => e.key === "Enter" && applyPomoEdit()} use:focusNoScroll />
            {:else}
              <button onclick={() => startPomoEdit(f.key)}
                class="hit px-1.5 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer underline decoration-dotted underline-offset-2 rounded"
              >{f.get()}m</button>
            {/if}
          </div>
          {#if fi < pomoFields.length - 1}<div class="w-px h-5 bg-border-subtle"></div>{/if}
        {/each}

        <!-- Rounds field -->
        <div class="w-px h-5 bg-border-subtle"></div>
        <div class="flex items-center gap-1 px-3 py-2 text-[0.7rem] text-text-muted">
          <span>Rounds:</span>
          {#if editingPomoField === "rounds"}
            <input class="w-5 bg-transparent border-b border-accent-timer outline-none text-text-primary text-[0.7rem] text-center"
              bind:value={pomoEditVal} oninput={onlyDigits} onblur={applyPomoEdit}
              onkeydown={(e) => e.key === "Enter" && applyPomoEdit()} use:focusNoScroll />
          {:else}
            <button onclick={() => startPomoEdit("rounds")}
              class="hit px-1.5 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer underline decoration-dotted underline-offset-2 rounded"
            >{pomodoroConfig.breakPattern.length}</button>
          {/if}
        </div>
      </div>

      <!-- ── Break planner ──────────────────────────────────────── -->
      <div class="w-full max-w-[380px]">
        <div class="flex items-center gap-1 px-1 mb-2">
          <span class="text-[0.65rem] font-semibold tracking-widest uppercase text-text-muted">Cycle Plan</span>
          <span class="text-[0.6rem] text-text-muted ml-1">— click break to cycle S/L/N</span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each pomodoroConfig.breakPattern as brk, i}
            {@const sessionDone = i < timerState.pomodoroSession - 1}
            {@const sessionActive = i === timerState.pomodoroSession - 1}
            {@const brkColor = brk === 'long-break' ? phaseColor['long-break'] : brk === 'short-break' ? phaseColor['short-break'] : 'var(--color-text-faint)'}
            {@const brkLabel = brk === 'long-break' ? 'L' : brk === 'short-break' ? 'S' : 'N'}
            <div class="flex items-center gap-1">
              <!-- Work block -->
              <div
                class="flex items-center justify-center w-7 h-7 rounded-lg text-[0.6rem] font-semibold tabular-nums transition-all duration-200"
                style="background:{sessionDone ? tint(phaseColor['work'], 19) : sessionActive ? tint(phaseColor['work'], 13) : 'var(--color-bg-surface)'};
                       color:{sessionDone || sessionActive ? phaseColor['work'] : 'var(--color-text-muted)'};
                       border:1px solid {sessionActive ? tint(phaseColor['work'], 38) : 'var(--color-border-default)'}"
              >{i + 1}</div>
              <!-- Arrow -->
              <span class="text-[0.55rem] text-text-muted opacity-40">›</span>
              <!-- Break badge — cycles S → L → N on click -->
              <button
                onclick={() => toggleBreakType(i)}
                disabled={timerState.running}
                title="Click to cycle: Short → Long → None"
                class="hit hit-badge flex items-center justify-center w-6 h-6 rounded text-[0.6rem] font-bold transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:hover:scale-100"
                style="background:{tint(brkColor, 13)}; color:{brkColor}; border:1px solid {tint(brkColor, 31)}; cursor:{timerState.running ? 'not-allowed' : 'pointer'}"
              >{brkLabel}</button>
            </div>
          {/each}
        </div>
        <!-- Legend -->
        <div class="flex gap-3 mt-2 px-1">
          <span class="flex items-center gap-1 text-[0.6rem]" style="color:{phaseColor['short-break']}">
            <span class="font-bold">S</span> Short ({pomodoroConfig.shortBreak / 60}m)
          </span>
          <span class="flex items-center gap-1 text-[0.6rem]" style="color:{phaseColor['long-break']}">
            <span class="font-bold">L</span> Long ({pomodoroConfig.longBreak / 60}m)
          </span>
          <span class="flex items-center gap-1 text-[0.6rem] text-text-muted">
            <span class="font-bold">N</span> No break
          </span>
        </div>
      </div>

      <!-- ── Task list ───────────────────────────────────────────── -->
      <div class="w-full max-w-[380px] flex flex-col gap-2">

        <!-- Header -->
        <div class="flex items-center justify-between px-1">
          <span class="text-[0.65rem] font-semibold tracking-widest uppercase text-text-muted">Tasks</span>
          {#if pomoTasks.length > 0}
            <span class="text-[0.65rem] text-text-muted tabular-nums">
              {pomoTasks.filter((t) => t.done).length}/{pomoTasks.length} done
            </span>
          {/if}
        </div>

        <!-- Task items -->
        {#if pomoTasks.length > 0}
          <div class="flex flex-col gap-1">
            {#each pomoTasks as task (task.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <div
                onclick={(e) => { if (!(e.target as HTMLElement).closest("button, input")) setActive(task.id); }}
                class="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-150 cursor-pointer
                          {task.id === pomoMeta.activeTaskId
                            ? 'border-opacity-30 bg-opacity-10'
                            : 'border-transparent hover:bg-bg-hover hover:border-border-subtle border'}
                          {task.done ? 'opacity-40' : ''}"
                style={task.id === pomoMeta.activeTaskId ? `border-color:${tint(phaseColor['work'], 25)}; background:${tint(phaseColor['work'], 3)}` : ''}
              >
                <!-- Done toggle -->
                <button
                  onclick={() => toggleDone(task.id)}
                  class="hit w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors duration-150 cursor-pointer"
                  style={task.done ? `background:${phaseColor['work']}; border-color:${phaseColor['work']}` : 'border-color:var(--color-border-default)'}
                >
                  {#if task.done}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2.5 2.5 3.5-4" stroke="var(--color-on-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  {/if}
                </button>

                <!-- Task name — click to set as active -->
                <button
                  onclick={() => setActive(task.id)}
                  class="flex-1 text-left text-[0.78rem] truncate transition-colors duration-150 cursor-pointer
                         {task.done ? 'line-through text-text-muted' : task.id === pomoMeta.activeTaskId ? 'text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'}"
                >{task.text}</button>

                <!-- Pomodoro count — click estimated to edit -->
                <div class="flex items-center gap-1 shrink-0 text-[0.68rem]">
                  <span class="text-text-muted tabular-nums">{task.completed}/</span>
                  {#if editingEstId === task.id}
                    <input
                      type="number" min="1" max="20"
                      bind:value={editEstVal}
                      onblur={applyEstEdit}
                      onkeydown={(e) => { if (e.key === "Enter") applyEstEdit(); if (e.key === "Escape") editingEstId = null; }}
                      class="w-7 bg-transparent border-b border-accent-timer outline-none text-text-primary text-center appearance-none
                             [&::-webkit-inner-spin-button]:appearance-none"
                      use:focusNoScroll
                    />
                  {:else}
                    <button
                      onclick={() => openEstEdit(task)}
                      class="hit text-text-muted hover:text-text-primary cursor-pointer tabular-nums"
                      title="Edit estimated pomodoros"
                    >{task.estimated}</button>
                  {/if}
                </div>

                <!-- Delete (on hover) -->
                <button
                  onclick={() => removeTask(task.id)}
                  class="hit opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 text-text-muted hover:text-text-primary transition-opacity duration-150 cursor-pointer w-4 h-4 flex items-center justify-center shrink-0 text-base leading-none"
                  title="Remove task"
                >×</button>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Add task form -->
        <form
          onsubmit={(e) => { e.preventDefault(); submitTask(); }}
          class="flex gap-2 w-full max-w-[380px]"
        >
          <input
            bind:value={newTaskText}
            placeholder="Add a task..."
            class="flex-1 min-w-0 bg-bg-surface border border-border-default rounded-xl px-3.5 py-2.5 text-[0.78rem]
                   text-text-primary placeholder-text-muted outline-none transition-colors duration-150
                   focus:border-accent-timer"
            style="--placeholder-color: var(--color-text-faint)"
          />
          <button
            type="submit"
            class="hit px-4 py-2.5 text-[0.75rem] font-semibold rounded-xl border cursor-pointer transition-all duration-150 focus-visible:-outline-offset-2
                   border-border-default text-text-muted hover:text-text-primary hover:bg-bg-hover"
          >Add</button>
        </form>
      </div>
    {/if}

    <!-- ── Lap table (stopwatch) ─────────────────────────────────── -->
    {#if timerState.mode === "stopwatch" && timerState.laps.length > 0}
      <div class="w-full max-w-sm shrink-0 rounded-xl border border-border-default overflow-hidden">
        <table class="w-full text-xs">
          <thead>
            <tr class="bg-bg-surface border-b border-border-subtle">
              <th class="text-left px-4 py-2.5 text-text-muted font-medium">#</th>
              <th class="text-right px-4 py-2.5 text-text-muted font-medium">Lap</th>
              <th class="text-right px-4 py-2.5 text-text-muted font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {#each [...timerState.laps].reverse() as l, ri}
              {@const origIdx = timerState.laps.length - 1 - ri}
              {@const isFast = origIdx === fastestIdx()}
              {@const isSlow = origIdx === slowestIdx()}
              <tr class="border-b border-border-subtle last:border-0 {isFast ? 'bg-[var(--tag-2-bg)]' : isSlow ? 'bg-[var(--tag-1-bg)]' : ''}">
                <td class="px-4 py-2.5 {isFast || isSlow ? 'text-text-primary' : 'text-text-muted'}">{l.index}</td>
                <td class="text-right px-4 py-2.5 {isFast ? 'text-[var(--tag-2-fg)]' : isSlow ? 'text-[var(--tag-1-fg)]' : 'text-text-secondary'}">
                  {#if isFast}<span class="text-[0.6rem] mr-1">▲</span>{/if}
                  {#if isSlow}<span class="text-[0.6rem] mr-1">▼</span>{/if}
                  {formatLapMs(l.lapTime)}
                </td>
                <td class="text-right px-4 py-2.5 {isFast || isSlow ? 'text-text-primary' : 'text-text-muted'}">{formatLapMs(l.total)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

  </div><!-- end scrollable bottom -->
  </div><!-- end main content -->

  <!-- ── Footer ─────────────────────────────────────────────────── -->
  <div class="shrink-0 border-t border-border-default px-5 py-2.5 flex items-center justify-between bg-bg-panel">
    <span class="text-[0.7rem] text-text-muted">
      Today:
      <span class="text-text-secondary">{formatTime(todayFocusSeconds())}</span> focus ·
      <span class="text-text-secondary tabular-nums">{todayPomos()}</span>
      <span style="color:{phaseColor['work']}; opacity:0.7"> 🍅</span>
    </span>

    <div class="flex items-center gap-2">
      <!-- Sound toggles -->
      <button
        onclick={() => { soundConfig.alarmEnabled = !soundConfig.alarmEnabled; }}
        title="{soundConfig.alarmEnabled ? 'Alarm on' : 'Alarm off'} — click to toggle"
        class="hit flex items-center gap-1 px-2 py-1 rounded-lg text-[0.65rem] transition-colors duration-150 cursor-pointer
               {soundConfig.alarmEnabled ? 'text-text-secondary hover:text-text-primary' : 'text-text-muted hover:text-text-secondary'}"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          {#if !soundConfig.alarmEnabled}<line x1="2" y1="2" x2="22" y2="22"/>{/if}
        </svg>
        <span>{soundConfig.alarmEnabled ? "on" : "off"}</span>
      </button>

      <button
        onclick={() => { soundConfig.tickEnabled = !soundConfig.tickEnabled; }}
        title="{soundConfig.tickEnabled ? 'Tick on' : 'Tick off'} — click to toggle"
        class="hit flex items-center gap-1 px-2 py-1 rounded-lg text-[0.65rem] transition-colors duration-150 cursor-pointer
               {soundConfig.tickEnabled ? 'text-text-secondary hover:text-text-primary' : 'text-text-muted hover:text-text-secondary'}"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span class={soundConfig.tickEnabled ? '' : 'line-through'}>tick</span>
      </button>

      {#if timerState.sessionLog.length > 0}
        <div class="w-px h-4 bg-border-subtle"></div>
        <details bind:this={logEl} class="relative text-[0.7rem] text-text-muted">
          <summary class="hit cursor-pointer hover:text-text-secondary list-none select-none">
            {timerState.sessionLog.length} session{timerState.sessionLog.length !== 1 ? "s" : ""} ▾
          </summary>
          <div class="absolute bottom-8 right-0 bg-bg-surface border border-border-default rounded-xl p-3
                      max-h-48 overflow-y-auto z-20 min-w-[200px] shadow-xl">
            {#each timerState.sessionLog as s}
              <div class="flex justify-between gap-6 py-1 text-[0.7rem] text-text-secondary border-b border-border-subtle last:border-0">
                <span>{s.label}</span>
                <span class="text-text-muted">{formatTime(s.duration)}</span>
              </div>
            {/each}
          </div>
        </details>
      {/if}
    </div>
  </div>

</div>

<style>
  /* The timer renders at three very different widths: the centre column, a side panel
     (260-400px) and a phone. Sizing off the container rather than the viewport means it
     adapts in all three placements, including a narrow panel on a wide screen. */
  .timer-root {
    container-type: inline-size;
  }

  kbd {
    font-family: inherit;
  }

  /* Phones: 40px-tall touch area without moving anything. Horizontal reach stays inside
     the gaps between neighbours. Break chips use 34px, the pitch of their wrapped rows. */
  @media (pointer: coarse) {
    .hit {
      position: relative;
    }
    .hit::after {
      content: "";
      position: absolute;
      left: -4px;
      right: -4px;
      top: 50%;
      height: 40px;
      transform: translateY(-50%);
    }
    .hit-badge::after {
      height: 34px;
    }
  }

  /* The three-button row needs ~490px. Below that it was overflowing its container and
     getting clipped — on a phone the Skip button was cut in half, and in a side panel
     both Start and Reset were. Wrap first, then stack when even two won't fit. */
  @container (max-width: 500px) {
    .action-row {
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.75rem;
      max-width: 100%;
    }
  }

  @container (max-width: 360px) {
    .action-row {
      flex-direction: column;
      width: 100%;
      max-width: 260px;
      gap: 0.6rem;
    }
    .action-row > :global(button) {
      width: 100%;
    }
  }

  /* 32px of side padding is a lot of a 260px panel — reclaim it when space is tight. */
  @container (max-width: 340px) {
    .timer-root :global(.px-8) {
      padding-left: 1rem;
      padding-right: 1rem;
    }
  }

  /* Preset chips wrap rather than overflow once the row can't fit on one line. */
  @container (max-width: 380px) {
    .preset-row {
      flex-wrap: wrap;
      justify-content: center;
    }
  }

  /* The pomodoro settings row is ~490px wide; on a phone it was clipped ~50px each side
     with no way to scroll to the hidden Auto and Rounds controls. */
  @container (max-width: 520px) {
    .pomo-config {
      flex-wrap: wrap;
      justify-content: center;
      max-width: 100%;
    }
    .pomo-config > :global(.w-px) {
      display: none;
    }
  }
</style>
