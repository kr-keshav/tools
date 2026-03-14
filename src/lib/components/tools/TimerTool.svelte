<script lang="ts">
  import { onMount } from "svelte";
  import {
    timerState, pomodoroConfig, soundConfig,
    startStop, reset, lap, setMode, setCountdownTarget, skipPomodoro,
    currentSeconds, currentTotal, formatTime, formatMs, formatLapMs,
    swTotalMs, swLapMs, todayFocusSeconds, buildBreakPattern,
    type TimerMode, type PomodoroPhase, type BreakType,
  } from "$lib/stores/timerState.svelte";
  import {
    pomoTasks, pomoMeta,
    addTask, removeTask, toggleDone, setActive, incrementCompleted, setEstimated,
  } from "$lib/stores/pomodoroTasks.svelte";

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

  // ── Detect pomodoro work session completion → increment active task ─
  let _prevLogLen = timerState.sessionLog.length;
  $effect(() => {
    const log = timerState.sessionLog;
    if (log.length > _prevLogLen) {
      const newest = log[0];
      if (newest.mode === "pomodoro" && newest.label.startsWith("Work")) {
        if (pomoMeta.activeTaskId !== null) incrementCompleted(pomoMeta.activeTaskId);
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

  function openCountdownEdit() {
    if (timerState.running) return;
    if (timerState.mode !== "countdown" && timerState.mode !== "pomodoro") return;
    const t = currentSeconds(); // remaining seconds for either mode
    cdHours   = String(Math.floor(t / 3600));
    cdMinutes = String(Math.floor((t % 3600) / 60));
    cdSeconds = String(t % 60);
    editingCountdown = true;
  }

  function applyCountdownEdit() {
    editingCountdown = false;
    const h = Math.max(0, parseInt(cdHours)   || 0);
    const m = Math.max(0, parseInt(cdMinutes) || 0);
    const s = Math.min(59, Math.max(0, parseInt(cdSeconds) || 0));
    const secs = h * 3600 + m * 60 + s;
    if (secs <= 0) return;
    if (timerState.mode === "pomodoro") {
      timerState.pomodoroElapsed = Math.max(0, currentTotal() - secs);
      timerState.finished = false;
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
    if (!isNaN(val) && val > 0) {
      if (field === "work")  pomodoroConfig.workDuration = val * 60;
      else if (field === "short") pomodoroConfig.shortBreak = val * 60;
      else if (field === "long")  pomodoroConfig.longBreak = val * 60;
      else if (field === "rounds") {
        // resize pattern, preserving existing break types, always end with long-break
        pomodoroConfig.breakPattern = buildBreakPattern(val, pomodoroConfig.breakPattern);
      }
    }
    editingPomoField = null;
    reset();
  }

  const breakCycle: BreakType[] = ['short-break', 'long-break', 'no-break'];

  function toggleBreakType(i: number) {
    if (timerState.running) return;
    const p = pomodoroConfig.breakPattern;
    const idx = breakCycle.indexOf(p[i]);
    p[i] = breakCycle[(idx + 1) % breakCycle.length];
    reset();
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
  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "Space") { e.preventDefault(); startStop(); }
    if (e.code === "KeyR") reset();
    if (e.code === "KeyL") lap();
  }

  onMount(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    work: "#6c8ebf", "short-break": "#82b366", "long-break": "#b5866b",
  };
  const phaseLabel: Record<string, string> = {
    work: "Focus", "short-break": "Short Break", "long-break": "Long Break",
  };

  const accentColor = $derived(() =>
    timerState.mode === "pomodoro" ? phaseColor[timerState.pomodoroPhase] : "#6c8ebf"
  );

  // Rectangle border + tint based on phase
  const rectStyle = $derived(() => {
    if (timerState.mode !== "pomodoro") return "";
    const c = phaseColor[timerState.pomodoroPhase];
    return `border-color: ${c}50; background: color-mix(in srgb, ${c} 4%, #1a1a1a)`;
  });

  // ── Lap stats ─────────────────────────────────────────────────────
  const fastestIdx = $derived(() => {
    if (timerState.laps.length === 0) return -1;
    return timerState.laps.reduce((b, l, i) => l.lapTime < timerState.laps[b].lapTime ? i : b, 0);
  });
  const slowestIdx = $derived(() => {
    if (timerState.laps.length < 2) return -1;
    return timerState.laps.reduce((w, l, i) => l.lapTime > timerState.laps[w].lapTime ? i : w, 0);
  });
  const bestLapMs = $derived(() => fastestIdx() >= 0 ? timerState.laps[fastestIdx()].lapTime : 0);

  const modes: TimerMode[] = ["countdown", "stopwatch", "pomodoro"];

  const startLabel = $derived(() =>
    timerState.running ? "Stop" : timerState.accMs > 0 ? "Resume" : "Start"
  );

  const pomoFields = [
    { key: "work"  as const, label: "Work",  get: () => pomodoroConfig.workDuration / 60 },
    { key: "short" as const, label: "Short", get: () => pomodoroConfig.shortBreak / 60 },
    { key: "long"  as const, label: "Long",  get: () => pomodoroConfig.longBreak / 60 },
  ];

  const inputClass =
    "w-16 bg-transparent outline-none text-center font-mono font-semibold text-[2.6rem] " +
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

<div class="flex flex-col h-full select-none overflow-hidden font-mono">

  <!-- ── Mode tabs ──────────────────────────────────────────────── -->
  <div class="flex shrink-0 border-b border-border-default bg-bg-panel">
    {#each modes as m}
      <button
        onclick={() => setMode(m)}
        class="relative flex-1 py-3.5 text-[0.68rem] font-semibold tracking-[0.15em] uppercase
               transition-colors duration-150 cursor-pointer
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
  <div class="relative flex flex-col flex-1 overflow-hidden">

    <!-- Session completion toast -->
    <div
      class="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none
             flex items-center gap-2 px-4 py-2 rounded-xl border text-[0.72rem] font-mono font-medium
             transition-all duration-300 whitespace-nowrap"
      style="background:{phaseColor['work']}12; border-color:{phaseColor['work']}30; color:{phaseColor['work']};
             opacity:{toastVisible ? 1 : 0}; transform:translate(-50%, {toastVisible ? '0' : '-8px'})"
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
          style="color:{phaseColor[timerState.pomodoroPhase]}; background:{phaseColor[timerState.pomodoroPhase]}20"
        >{phaseLabel[timerState.pomodoroPhase]}</span>
        <span class="text-text-muted text-[0.7rem]">#{timerState.pomodoroSession}</span>
        <!-- Cycle dots -->
        <div class="flex gap-1.5 items-center">
          {#each pomodoroConfig.breakPattern as _, i}
            {@const isDone = i < timerState.pomodoroSession - 1}
            {@const isCurrent = i === timerState.pomodoroSession - 1 && timerState.pomodoroPhase === 'work'}
            <div
              class="rounded-full transition-all duration-300 {isCurrent ? 'w-2 h-2 ring-2 ring-offset-1 ring-offset-bg-panel' : 'w-1.5 h-1.5'}"
              style="background:{isDone || isCurrent ? phaseColor['work'] : '#2a2a2a'}; {isCurrent ? `ring-color:${phaseColor['work']}` : ''}"
            ></div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- ── Time rectangle ────────────────────────────────────────── -->
    <div
      class="w-full max-w-[380px] rounded-2xl overflow-hidden border transition-all duration-500"
      style={rectStyle()}
    >
      <div class="px-10 pt-9 pb-6 flex flex-col items-center gap-3">

        {#if timerState.mode === "stopwatch"}
          <!-- ── Stopwatch face ──────────────────────────────────── -->
          <div class="flex flex-col items-center gap-2">
            <span class="font-mono font-semibold text-[2.6rem] leading-none tracking-tight text-text-primary tabular-nums">
              {formatMs(displayTotalMs)}
            </span>
            <div class="flex items-center gap-2 text-[0.75rem]">
              <span class="text-text-muted">Lap {timerState.laps.length + 1}</span>
              <span style="color:#2a2a2a">·</span>
              <span class="font-mono text-text-secondary tabular-nums">{formatLapMs(displayLapMs)}</span>
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
                oninput={onlyDigits} onkeydown={(e) => onEditKey(e, null, minutesInput)} class={inputClass} use:focusNoScroll />
              <span class="text-[2.6rem] font-semibold text-text-muted leading-none">:</span>
              <input type="text" inputmode="numeric" bind:value={cdMinutes} bind:this={minutesInput}
                oninput={onlyDigits} onkeydown={(e) => onEditKey(e, hoursInput, secondsInput)} class={inputClass} />
              <span class="text-[2.6rem] font-semibold text-text-muted leading-none">:</span>
              <input type="text" inputmode="numeric" bind:value={cdSeconds} bind:this={secondsInput}
                oninput={onlyDigits} onblur={clampSeconds} onkeydown={(e) => onEditKey(e, minutesInput, null)} class={inputClass} />
            </div>
            <span class="text-[0.58rem] text-text-muted tracking-[0.2em] uppercase">Enter or click outside to set</span>
          </div>

        {:else}
          <!-- ── Countdown / Pomodoro face ──────────────────────── -->
          <div class="flex flex-col items-center gap-1.5">
            <button
              class="font-mono font-semibold leading-none tracking-tight text-[2.6rem] transition-all duration-150
                     {timerState.finished ? 'text-accent-timer' : 'text-text-primary'}
                     {(timerState.mode === 'countdown' || timerState.mode === 'pomodoro') && !timerState.running ? 'cursor-pointer hover:opacity-60' : 'cursor-default'}"
              onclick={openCountdownEdit}
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
                <span class="text-[0.65rem] font-mono shrink-0 tabular-nums"
                  style="color:{phaseColor[timerState.pomodoroPhase]}; opacity:0.7"
                >{t.completed}/{t.estimated}</span>
              </div>
            {:else if timerState.mode === "pomodoro" && !activeTask()}
              <span class="text-[0.62rem] text-text-muted mt-1 opacity-60">— select a task below —</span>
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
                style="width:{pct}%; background:{pct >= 100 ? '#b5866b' : '#6c8ebf'}"></div>
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
      <div class="flex gap-2">
        {#each presets as p}
          <button
            onclick={() => setCountdownTarget(p.secs)}
            class="min-w-[48px] px-4 py-2.5 text-[0.7rem] font-semibold rounded-lg border transition-all duration-150 cursor-pointer
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
        {timerState.pomodoroPhase === 'work' ? 'Break over — ready to focus?' : 'Session done — take a break'}
      </p>
    {/if}

    <!-- ── Controls ─────────────────────────────────────────────── -->
    {#if timerState.mode === "stopwatch"}
      <div class="flex items-center gap-4">
        {#if swIdle()}
          <button disabled class="flex items-center justify-center px-6 py-3.5 text-[0.78rem] font-semibold rounded-xl border border-border-subtle text-text-muted opacity-40 cursor-not-allowed">Reset</button>
          <button onclick={startStop} class="flex items-center gap-2.5 px-9 py-4 text-[0.82rem] font-semibold rounded-xl bg-accent-timer border border-accent-timer text-white hover:opacity-90 cursor-pointer shadow-lg transition-all duration-150 min-w-[120px] justify-center">
            Start <kbd class="text-[0.6rem] opacity-50 font-mono bg-white/10 px-1.5 py-0.5 rounded">Space</kbd>
          </button>
        {:else if swRunning()}
          <button onclick={lap} class="flex items-center gap-2 px-6 py-3.5 text-[0.78rem] font-semibold rounded-xl border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-hover cursor-pointer transition-all duration-150">
            Lap <kbd class="text-[0.6rem] text-text-muted font-mono bg-bg-hover px-1.5 py-0.5 rounded">L</kbd>
          </button>
          <button onclick={startStop} class="flex items-center gap-2.5 px-9 py-4 text-[0.82rem] font-semibold rounded-xl bg-bg-surface border border-border-default text-text-primary hover:bg-bg-hover cursor-pointer transition-all duration-150 min-w-[120px] justify-center">
            Stop <kbd class="text-[0.6rem] opacity-50 font-mono bg-white/10 px-1.5 py-0.5 rounded">Space</kbd>
          </button>
        {:else}
          <button onclick={reset} class="flex items-center gap-2 justify-center px-6 py-3.5 text-[0.78rem] font-semibold rounded-xl border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-hover cursor-pointer transition-all duration-150">
            Reset <kbd class="text-[0.6rem] text-text-muted font-mono bg-bg-hover px-1.5 py-0.5 rounded">R</kbd>
          </button>
          <button onclick={startStop} class="flex items-center gap-2.5 px-9 py-4 text-[0.82rem] font-semibold rounded-xl bg-accent-timer border border-accent-timer text-white hover:opacity-90 cursor-pointer shadow-lg transition-all duration-150 min-w-[120px] justify-center">
            Resume <kbd class="text-[0.6rem] opacity-50 font-mono bg-white/10 px-1.5 py-0.5 rounded">Space</kbd>
          </button>
        {/if}
      </div>

    {:else}
      <div class="flex items-center gap-4">
        <button onclick={startStop} disabled={timerState.finished}
          class="flex items-center gap-2.5 px-9 py-4 text-[0.82rem] font-semibold rounded-xl border
                 transition-all duration-150 min-w-[130px] justify-center
                 {timerState.finished
                   ? 'border-border-default text-text-muted opacity-40 cursor-not-allowed'
                   : timerState.running
                     ? 'bg-bg-surface border-border-default text-text-primary hover:bg-bg-hover cursor-pointer'
                     : 'border-accent-timer text-white hover:opacity-90 cursor-pointer shadow-lg'}"
          style={!timerState.finished && !timerState.running ? `background:${accentColor()}; border-color:${accentColor()}` : ''}
        >
          {timerState.running ? "Pause" : timerState.waitingForNext ? "Next" : "Start"}
          <kbd class="text-[0.6rem] opacity-50 font-mono bg-white/10 px-1.5 py-0.5 rounded">Space</kbd>
        </button>
        <button onclick={reset} class="flex items-center gap-2 justify-center px-6 py-3.5 text-[0.78rem] font-semibold rounded-xl border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all duration-150 cursor-pointer">
          Reset <kbd class="text-[0.6rem] text-text-muted font-mono bg-bg-hover px-1.5 py-0.5 rounded">R</kbd>
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
  <div class="flex-1 overflow-y-auto flex flex-col items-center gap-5 px-8 pb-6">

    <!-- ── Pomodoro config ───────────────────────────────────────── -->
    {#if timerState.mode === "pomodoro"}
      <div class="flex items-center gap-1 p-1 bg-bg-surface rounded-xl border border-border-subtle">
        <label class="flex items-center gap-2 px-3 py-2 cursor-pointer text-[0.7rem] text-text-muted hover:text-text-secondary transition-colors rounded-lg hover:bg-bg-hover">
          <input type="checkbox" bind:checked={pomodoroConfig.autoAdvance} class="accent-accent-timer cursor-pointer w-3 h-3" />
          Auto
        </label>
        <div class="w-px h-5 bg-border-subtle"></div>
        {#each pomoFields as f, fi}
          <div class="flex items-center gap-1 px-3 py-2 text-[0.7rem] text-text-muted">
            <span>{f.label}:</span>
            {#if editingPomoField === f.key}
              <input class="w-7 bg-transparent border-b border-accent-timer outline-none text-text-primary font-mono text-[0.7rem] text-center"
                bind:value={pomoEditVal} oninput={onlyDigits} onblur={applyPomoEdit}
                onkeydown={(e) => e.key === "Enter" && applyPomoEdit()} use:focusNoScroll />
            {:else}
              <button onclick={() => startPomoEdit(f.key)}
                class="px-1.5 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer underline decoration-dotted underline-offset-2 rounded"
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
            <input class="w-5 bg-transparent border-b border-accent-timer outline-none text-text-primary font-mono text-[0.7rem] text-center"
              bind:value={pomoEditVal} oninput={onlyDigits} onblur={applyPomoEdit}
              onkeydown={(e) => e.key === "Enter" && applyPomoEdit()} use:focusNoScroll />
          {:else}
            <button onclick={() => startPomoEdit("rounds")}
              class="px-1.5 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer underline decoration-dotted underline-offset-2 rounded"
            >{pomodoroConfig.breakPattern.length}</button>
          {/if}
        </div>
      </div>

      <!-- ── Break planner ──────────────────────────────────────── -->
      <div class="w-full max-w-[380px]">
        <div class="flex items-center gap-1 px-1 mb-2">
          <span class="text-[0.65rem] font-semibold tracking-widest uppercase text-text-muted">Cycle Plan</span>
          <span class="text-[0.6rem] text-text-muted opacity-50 ml-1">— click break to toggle S/L</span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each pomodoroConfig.breakPattern as brk, i}
            {@const sessionDone = i < timerState.pomodoroSession - 1}
            {@const sessionActive = i === timerState.pomodoroSession - 1}
            {@const brkColor = brk === 'long-break' ? phaseColor['long-break'] : brk === 'short-break' ? phaseColor['short-break'] : '#444'}
            {@const brkLabel = brk === 'long-break' ? 'L' : brk === 'short-break' ? 'S' : 'N'}
            <div class="flex items-center gap-1">
              <!-- Work block -->
              <div
                class="flex items-center justify-center w-7 h-7 rounded-lg text-[0.6rem] font-semibold tabular-nums transition-all duration-200"
                style="background:{sessionDone ? phaseColor['work'] + '30' : sessionActive ? phaseColor['work'] + '20' : '#1a1a1a'};
                       color:{sessionDone || sessionActive ? phaseColor['work'] : '#555'};
                       border:1px solid {sessionActive ? phaseColor['work'] + '60' : '#2a2a2a'}"
              >{i + 1}</div>
              <!-- Arrow -->
              <span class="text-[0.55rem] text-text-muted opacity-40">›</span>
              <!-- Break badge — cycles S → L → N on click -->
              <button
                onclick={() => toggleBreakType(i)}
                disabled={timerState.running}
                title="Click to cycle: Short → Long → None"
                class="flex items-center justify-center w-6 h-6 rounded text-[0.6rem] font-bold transition-all duration-200 cursor-pointer hover:scale-110"
                style="background:{brkColor}20; color:{brkColor}; border:1px solid {brkColor}50"
              >{brkLabel}</button>
            </div>
          {/each}
        </div>
        <!-- Legend -->
        <div class="flex gap-3 mt-2 px-1">
          <span class="flex items-center gap-1 text-[0.6rem]" style="color:{phaseColor['short-break']}; opacity:0.7">
            <span class="font-bold">S</span> Short ({pomodoroConfig.shortBreak / 60}m)
          </span>
          <span class="flex items-center gap-1 text-[0.6rem]" style="color:{phaseColor['long-break']}; opacity:0.7">
            <span class="font-bold">L</span> Long ({pomodoroConfig.longBreak / 60}m)
          </span>
          <span class="flex items-center gap-1 text-[0.6rem] opacity-50 text-text-muted">
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
              <div class="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-150 cursor-pointer
                          {task.id === pomoMeta.activeTaskId
                            ? 'border-opacity-30 bg-opacity-10'
                            : 'border-transparent hover:bg-bg-hover hover:border-border-subtle border'}
                          {task.done ? 'opacity-40' : ''}"
                style={task.id === pomoMeta.activeTaskId ? `border-color:${phaseColor['work']}40; background:${phaseColor['work']}08` : ''}
              >
                <!-- Done toggle -->
                <button
                  onclick={() => toggleDone(task.id)}
                  class="w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors duration-150 cursor-pointer"
                  style={task.done ? `background:${phaseColor['work']}; border-color:${phaseColor['work']}` : 'border-color:#2a2a2a'}
                >
                  {#if task.done}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2.5 2.5 3.5-4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
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
                <div class="flex items-center gap-1 shrink-0 text-[0.68rem] font-mono">
                  <span class="text-text-muted tabular-nums">{task.completed}/</span>
                  {#if editingEstId === task.id}
                    <input
                      type="number" min="1" max="20"
                      bind:value={editEstVal}
                      onblur={applyEstEdit}
                      onkeydown={(e) => e.key === "Enter" && applyEstEdit()}
                      class="w-7 bg-transparent border-b border-accent-timer outline-none text-text-primary text-center appearance-none
                             [&::-webkit-inner-spin-button]:appearance-none"
                      use:focusNoScroll
                    />
                  {:else}
                    <button
                      onclick={() => openEstEdit(task)}
                      class="text-text-muted hover:text-text-primary cursor-pointer tabular-nums"
                      title="Edit estimated pomodoros"
                    >{task.estimated}</button>
                  {/if}
                </div>

                <!-- Delete (on hover) -->
                <button
                  onclick={() => removeTask(task.id)}
                  class="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary transition-opacity duration-150 cursor-pointer w-4 h-4 flex items-center justify-center shrink-0 text-base leading-none"
                  title="Remove task"
                >×</button>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Add task form -->
        <form
          onsubmit={(e) => { e.preventDefault(); submitTask(); }}
          class="flex gap-2"
        >
          <input
            bind:value={newTaskText}
            placeholder="Add a task..."
            class="flex-1 bg-bg-surface border border-border-default rounded-xl px-3.5 py-2.5 text-[0.78rem]
                   text-text-primary placeholder-text-muted outline-none transition-colors duration-150 font-mono
                   focus:border-accent-timer"
            style="--placeholder-color: #555"
          />
          <button
            type="submit"
            class="px-4 py-2.5 text-[0.75rem] font-semibold rounded-xl border cursor-pointer transition-all duration-150
                   border-border-default text-text-muted hover:text-text-primary hover:bg-bg-hover"
          >Add</button>
        </form>
      </div>
    {/if}

    <!-- ── Lap table (stopwatch) ─────────────────────────────────── -->
    {#if timerState.mode === "stopwatch" && timerState.laps.length > 0}
      <div class="w-full max-w-sm rounded-xl border border-border-default overflow-hidden">
        <table class="w-full text-xs font-mono">
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
              <tr class="border-b border-border-subtle last:border-0 {isFast ? 'bg-accent-notes/5' : isSlow ? 'bg-accent-todo/5' : ''}">
                <td class="px-4 py-2.5 text-text-muted">{l.index}</td>
                <td class="text-right px-4 py-2.5 {isFast ? 'text-accent-notes' : isSlow ? 'text-accent-todo' : 'text-text-secondary'}">
                  {#if isFast}<span class="text-[0.6rem] mr-1 opacity-60">▲</span>{/if}
                  {#if isSlow}<span class="text-[0.6rem] mr-1 opacity-60">▼</span>{/if}
                  {formatLapMs(l.lapTime)}
                </td>
                <td class="text-right px-4 py-2.5 text-text-muted">{formatLapMs(l.total)}</td>
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
        class="flex items-center gap-1 px-2 py-1 rounded-lg text-[0.65rem] font-mono transition-colors duration-150 cursor-pointer
               {soundConfig.alarmEnabled ? 'text-text-secondary hover:text-text-primary' : 'text-text-muted opacity-50 hover:opacity-80'}"
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
        class="flex items-center gap-1 px-2 py-1 rounded-lg text-[0.65rem] font-mono transition-colors duration-150 cursor-pointer
               {soundConfig.tickEnabled ? 'text-text-secondary hover:text-text-primary' : 'text-text-muted opacity-50 hover:opacity-80'}"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span>tick</span>
      </button>

      {#if timerState.sessionLog.length > 0}
        <div class="w-px h-4 bg-border-subtle"></div>
        <details class="relative text-[0.7rem] text-text-muted">
          <summary class="cursor-pointer hover:text-text-secondary list-none select-none">
            {timerState.sessionLog.length} session{timerState.sessionLog.length !== 1 ? "s" : ""} ▾
          </summary>
          <div class="absolute bottom-8 right-0 bg-bg-surface border border-border-default rounded-xl p-3
                      max-h-48 overflow-y-auto z-20 min-w-[200px] shadow-xl">
            {#each timerState.sessionLog as s}
              <div class="flex justify-between gap-6 py-1 font-mono text-[0.7rem] text-text-secondary border-b border-border-subtle last:border-0">
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
