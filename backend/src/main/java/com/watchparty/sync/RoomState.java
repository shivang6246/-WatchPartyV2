package com.watchparty.sync;

import java.util.UUID;

/**
 * The room's authoritative playback state: a position anchored to a server
 * timestamp, not a live counter.
 *
 * <p>Any client can therefore compute where playback should be right now as
 * {@code position + (now - anchor) * speed}, which is why a joiner needs one
 * read and no replay of history.
 *
 * @param positionMs position at {@code anchorTs}
 * @param anchorTs server epoch millis the position was stamped at
 * @param sequence monotonic per room; clients drop anything not greater than
 *     the last sequence they applied
 */
public record RoomState(
        UUID roomId,
        long positionMs,
        boolean playing,
        float speed,
        long anchorTs,
        Long durationMs,
        boolean locked,
        long sequence) {

    /** Where playback should be at {@code nowMs}, by server clock. */
    public long projectedPositionMs(long nowMs) {
        if (!playing) {
            return positionMs;
        }
        long elapsed = Math.max(0, nowMs - anchorTs);
        long projected = positionMs + (long) (elapsed * speed);
        return durationMs == null ? projected : Math.min(projected, durationMs);
    }

    /**
     * When the next event on this state takes effect, given the moment the
     * member says they acted ({@code claimedAt}, server clock; null if they did
     * not say). Anchoring there rather than at the frame's arrival means the
     * presser's own player, which moved at the click, already agrees with the
     * echo. Bounded: never in the future, never more than {@code maxBackdateMs}
     * ago, and never before this state's own anchor.
     */
    public long anchorFor(Long claimedAt, long nowMs, long maxBackdateMs) {
        if (claimedAt == null) {
            return nowMs;
        }
        long earliest = Math.min(nowMs, Math.max(anchorTs, nowMs - maxBackdateMs));
        return Math.max(earliest, Math.min(claimedAt, nowMs));
    }
}
