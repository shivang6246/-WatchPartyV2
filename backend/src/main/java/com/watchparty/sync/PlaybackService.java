package com.watchparty.sync;

import com.watchparty.metrics.WatchPartyMetrics;
import com.watchparty.ratelimit.RateLimits;
import com.watchparty.ratelimit.RedisRateLimiter;
import com.watchparty.room.PlaybackEventEntity;
import com.watchparty.room.PlaybackEventRepository;
import com.watchparty.room.Room;
import com.watchparty.room.RoomMember;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The server side of the sync engine.
 *
 * <p>Two rules do most of the work. The server never treats a client's reported
 * position as authority: a seek carries the position a member is asking for,
 * and the server validates it, re-stamps it with its own clock and assigns the
 * sequence. And the sequence is monotonic per room, so clients discard anything
 * not greater than what they last applied — which absorbs out-of-order
 * delivery, duplicates from a reconnect, and two members seeking at the same
 * instant, with no negotiation round.
 */
@Service
public class PlaybackService {

    private static final Logger log = LoggerFactory.getLogger(PlaybackService.class);

    /** A heartbeat claiming more corrections than this is not a real client. */
    private static final int MAX_CORRECTIONS_PER_BEAT = 20;

    private static final Set<String> ACTIONS = Set.of("play", "pause", "seek", "rate");

    /** Beyond this the client is treated as behind rather than drifting. */
    private static final long BEHIND_THRESHOLD_MS = 2000;

    /**
     * How far back a member's "I pressed at" may anchor an event. It covers the
     * YouTube player's 350 ms burst settle plus the trip here, with room for a
     * slow network; anything claiming more is anchored this far back.
     */
    static final long MAX_BACKDATE_MS = 1500;

    private final RoomStateService stateService;
    private final RoomEventPublisher events;
    private final PlaybackEventRepository eventLog;
    private final RedisRateLimiter limiter;
    private final WatchPartyMetrics metrics;

    public PlaybackService(
            RoomStateService stateService,
            RoomEventPublisher events,
            PlaybackEventRepository eventLog,
            RedisRateLimiter limiter,
            WatchPartyMetrics metrics) {
        this.stateService = stateService;
        this.events = events;
        this.eventLog = eventLog;
        this.limiter = limiter;
        this.metrics = metrics;
    }

    /**
     * Handles one inbound playback request.
     *
     * <p>A rejection is not a special case: the member gets the authoritative
     * state back on their error queue, which their ordinary drift correction
     * already knows how to apply, so a client that tries to control a locked
     * room simply snaps back instead of diverging.
     *
     * <p>Everything between the frame and the broadcast is Redis, apart from the
     * caller's membership check: the room row is read only when the room is
     * cold, and the history row is written after everyone has been told. Every
     * database round trip here is time the room waits after the host presses.
     *
     * @param room loads the room row; called only when Redis has no live state
     */
    public void handle(UUID roomId, Supplier<Room> room, RoomMember member, PlaybackMessage inbound, String principalName) {
        RoomState live = stateService.read(roomId);
        RoomState current = live != null ? live : stateService.hydrate(room.get());

        String action = inbound.action() == null ? "" : inbound.action().toLowerCase();
        if (!ACTIONS.contains(action)) {
            reject(principalName, current, "unknown", "bad_action", "Unknown playback action.");
            return;
        }

        var decision = limiter.consume(
                RateLimits.PLAYBACK_EVENT.bucket(),
                member.getId().toString(),
                RateLimits.PLAYBACK_EVENT.limit(),
                RateLimits.PLAYBACK_EVENT.window());
        if (!decision.allowed()) {
            // Without this one member can hold a room hostage by seeking in a
            // loop, since every accepted event is broadcast to everyone.
            reject(principalName, current, action, "rate_limited", "Slow down.");
            return;
        }

        if (current.locked() && !member.isHost()) {
            reject(principalName, current, action, "room_locked", "Only the host controls playback.");
            return;
        }

        if ("rate".equals(action) && !member.isHost()) {
            reject(principalName, current, action, "host_only", "Only the host can change playback speed.");
            return;
        }

        Long duration = current.durationMs();
        if (duration == null && inbound.durationMs() != null && inbound.durationMs() > 0) {
            // The server cannot know a YouTube video's length on its own, so the
            // first credible report from a client seeds it.
            duration = inbound.durationMs();
        }

        // When the member pressed, which is where their own player already is.
        long at = current.anchorFor(inbound.serverTs(), System.currentTimeMillis(), MAX_BACKDATE_MS);

        long requested = switch (action) {
            case "seek" -> clamp(inbound.positionMs() == null ? 0 : inbound.positionMs(), duration);
            // play and pause take effect where the room's playback was at that
            // moment, not where the pressing client happens to have buffered to.
            default -> clamp(current.projectedPositionMs(at), duration);
        };

        boolean playing = switch (action) {
            case "play" -> true;
            case "pause" -> false;
            case "seek" -> inbound.playing() == null ? current.playing() : inbound.playing();
            default -> current.playing();
        };

        float speed = "rate".equals(action) ? clampSpeed(inbound.speedOrDefault()) : current.speed();

        RoomState updated = stateService.apply(roomId, requested, playing, speed, duration, at);
        if (updated == null) {
            updated = stateService.hydrate(room.get());
        }

        events.publish(roomId, "playback", PlaybackMessage.from(updated, action, member.getId().toString()));
        metrics.playbackEvent(action, "accepted");

        // History only: nothing on the way to the room reads it, and a failure
        // here must not turn an event everyone has already applied into an error.
        try {
            eventLog.save(new PlaybackEventEntity(
                    roomId,
                    member.getId(),
                    action,
                    updated.positionMs(),
                    updated.playing(),
                    updated.speed(),
                    updated.sequence(),
                    Instant.ofEpochMilli(updated.anchorTs())));
        } catch (RuntimeException ex) {
            log.warn("Playback event {} for room {} was applied but not logged", updated.sequence(), roomId, ex);
        }
    }

    /** Sends the current state to one member, e.g. after a reconnect. */
    public void sendState(Room room, String principalName) {
        RoomState state = stateService.load(room);
        events.sendError(
                principalName,
                Map.of("code", "resync", "message", "Current room state.", "state",
                        PlaybackMessage.from(state, "sync", null)));
    }

    /**
     * Position reports are telemetry only: they never move the room. They keep
     * presence alive and drive the host's "members behind" indicator.
     */
    /**
     * Records a member's heartbeat and health.
     *
     * @return true when this heartbeat brought the member back (they had aged
     *     out, or another tab's disconnect had marked them gone)
     */
    public boolean heartbeat(UUID roomId, UUID memberId, PlaybackMessage report, boolean buffering) {
        boolean arrived = stateService.heartbeat(roomId, memberId);
        RoomState state = stateService.read(roomId);
        if (state == null || report.positionMs() == null) {
            return arrived;
        }
        long drift = Math.abs(state.projectedPositionMs(System.currentTimeMillis()) - report.positionMs());
        if (state.playing() && !buffering) {
            // Paused and buffering members are expected to be off the
            // projection; counting them would only blur the signal.
            metrics.recordDrift(drift);
        }
        boolean behind = buffering || (state.playing() && drift > BEHIND_THRESHOLD_MS);
        // Only a change is broadcast, so a ten-member room does not pay a
        // fan-out for every heartbeat it receives.
        if (stateService.recordHealth(roomId, memberId, behind)) {
            events.publish(
                    roomId,
                    "members",
                    Map.of(
                            "type", "health",
                            "memberId", memberId.toString(),
                            "behind", behind,
                            "driftMs", drift));
        }
        return arrived;
    }

    /**
     * Counts how often clients reach each tier of the drift ladder. A resync
     * means a correction failed or an event was lost, so each one is also
     * logged with enough context to find the room.
     */
    public void recordCorrections(UUID roomId, UUID memberId, Integer rate, Integer seek, Integer resync) {
        metrics.correction("rate", bounded(rate));
        metrics.correction("seek", bounded(seek));
        int resyncs = bounded(resync);
        metrics.correction("resync", resyncs);
        if (resyncs > 0) {
            log.atWarn()
                    .addKeyValue("roomId", roomId)
                    .addKeyValue("memberId", memberId)
                    .addKeyValue("resyncs", resyncs)
                    .log("Sync defect: client drifted past the resync threshold");
        }
    }

    private static int bounded(Integer count) {
        return count == null ? 0 : Math.max(0, Math.min(count, MAX_CORRECTIONS_PER_BEAT));
    }

    private void reject(String principalName, RoomState state, String action, String code, String message) {
        metrics.playbackEvent(action, code);
        events.sendError(
                principalName,
                Map.of("code", code, "message", message, "state", PlaybackMessage.from(state, "sync", null)));
    }

    private static long clamp(long positionMs, Long durationMs) {
        long floored = Math.max(0, positionMs);
        return durationMs == null ? floored : Math.min(floored, durationMs);
    }

    private static float clampSpeed(float speed) {
        return Math.min(2.0f, Math.max(0.25f, speed));
    }
}
