/**
 * Estimates this browser's offset from server time.
 *
 * <p>The client sends t0, the server stamps t1, the client notes t2 on arrival:
 *
 *     offset = t1 - (t0 + t2) / 2,   rtt = t2 - t0
 *
 * Five probes are taken and the offset from the probe with the *lowest* round
 * trip wins, rather than the mean. A single congested probe skews an average
 * badly, while the fastest probe is the one least distorted by queueing.
 */
export class ServerClock {
  private offsetMs = 0;
  private bestRttMs = Number.POSITIVE_INFINITY;
  private sampleCount = 0;

  /** Records one completed probe. */
  addSample(t0: number, t1: number, t2: number) {
    const rtt = t2 - t0;
    if (rtt < 0) return;
    this.sampleCount += 1;
    if (rtt < this.bestRttMs) {
      this.bestRttMs = rtt;
      this.offsetMs = t1 - (t0 + t2) / 2;
    }
  }

  /** Starts a fresh round so a changed network path is not judged by old samples. */
  beginRound() {
    this.bestRttMs = Number.POSITIVE_INFINITY;
  }

  now(): number {
    return Date.now() + this.offsetMs;
  }

  get offset() {
    return this.offsetMs;
  }

  get rtt() {
    return Number.isFinite(this.bestRttMs) ? this.bestRttMs : 0;
  }

  get synced() {
    return this.sampleCount > 0;
  }
}
