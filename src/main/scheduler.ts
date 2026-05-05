// ── Daily Job Scheduler ─────────────────────────────────────────────────────
// setTimeout-based, self-rescheduling.  Avoids the node-schedule dep for a
// tray app that only runs two recurring jobs.
//
// Each job has a label (unique), an HH:MM local time, and a fire callback.
// On fire, the timer is reset for the same HH:MM tomorrow.  Changing a
// settings field in the UI calls `schedule()` again with the same label,
// which cancels the old timer before arming the new one.

export type JobFire = () => void | Promise<void>;

interface Job {
  label: string;
  time: string;        // "HH:MM"
  fire: JobFire;
  timer: NodeJS.Timeout | null;
  nextFireMs: number;  // absolute epoch ms of next firing (diagnostic)
}

function parseHHMM(time: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

export class Scheduler {
  private jobs = new Map<string, Job>();

  /** Install or replace a recurring daily job. */
  schedule(label: string, time: string, fire: JobFire): void {
    const parsed = parseHHMM(time);
    if (!parsed) {
      console.warn(`[scheduler] invalid time "${time}" for job "${label}"; not scheduling.`);
      this.cancel(label);
      return;
    }
    this.cancel(label);
    const job: Job = { label, time, fire, timer: null, nextFireMs: 0 };
    this.jobs.set(label, job);
    this.arm(job, parsed.h, parsed.m);
  }

  /** Cancel a scheduled job. */
  cancel(label: string): void {
    const job = this.jobs.get(label);
    if (!job) return;
    if (job.timer) clearTimeout(job.timer);
    this.jobs.delete(label);
  }

  /** Diagnostic view of every scheduled job. */
  list(): Array<{ label: string; time: string; nextFire: Date }> {
    return [...this.jobs.values()].map((j) => ({
      label: j.label,
      time: j.time,
      nextFire: new Date(j.nextFireMs),
    }));
  }

  private arm(job: Job, h: number, m: number): void {
    const now = new Date();
    const next = new Date();
    next.setHours(h, m, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    const delay = next.getTime() - now.getTime();
    job.nextFireMs = next.getTime();
    job.timer = setTimeout(() => {
      void this.tick(job, h, m);
    }, delay);
  }

  private async tick(job: Job, h: number, m: number): Promise<void> {
    try {
      await job.fire();
    } catch (err) {
      console.error(`[scheduler] "${job.label}" fire failed:`, err);
    }
    // Only re-arm if this job is still registered (not cancelled during fire).
    if (this.jobs.get(job.label) === job) {
      this.arm(job, h, m);
    }
  }
}
