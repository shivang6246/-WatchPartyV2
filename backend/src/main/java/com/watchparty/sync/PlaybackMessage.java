package com.watchparty.sync;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * One shape, both directions.
 *
 * <p>Inbound the client sets {@code action}, {@code positionMs} and
 * {@code playing}, and may set {@code serverTs} to when the member acted by
 * its estimate of the server clock, which the server uses, within bounds, as
 * the event's anchor ({@link RoomState#anchorFor}); the rest stays empty.
 * Outbound the server has filled every field, {@code serverTs} being the
 * anchor. Because a rejection is just the authoritative state arriving
 * with a sequence the client has not seen, accepted and rejected events go
 * through exactly the same client code path.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PlaybackMessage(
        String action,
        Long positionMs,
        Boolean playing,
        Float speed,
        Long durationMs,
        Long sequence,
        Long serverTs,
        String memberId) {

    public static PlaybackMessage from(RoomState state, String action, String memberId) {
        return new PlaybackMessage(
                action,
                state.positionMs(),
                state.playing(),
                state.speed(),
                state.durationMs(),
                state.sequence(),
                state.anchorTs(),
                memberId);
    }

    public float speedOrDefault() {
        return speed == null || speed <= 0 ? 1.0f : speed;
    }

    public boolean playingOrDefault() {
        return playing != null && playing;
    }
}
