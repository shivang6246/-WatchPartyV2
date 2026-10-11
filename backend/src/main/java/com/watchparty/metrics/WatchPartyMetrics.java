package com.watchparty.metrics;

import com.watchparty.security.SessionRegistry;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/**
 * Every meter the product publishes, in one place, so a dashboard can be
 * written against this file rather than against grep.
 *
 * <p>The ones that matter most are the drift-correction tiers: a room where
 * clients keep reaching the seek or resync tier means the clock sync or the
 * network assumptions are wrong, long before anyone files a complaint.
 */
@Component
public class WatchPartyMetrics {

    private final MeterRegistry registry;
    private final AtomicLong activeRooms = new AtomicLong();
    private final Timer applyScript;
    private final DistributionSummary drift;
    private final Timer assistantReply;

    public WatchPartyMetrics(MeterRegistry registry, SessionRegistry sessions) {
        this.registry = registry;

        Gauge.builder("watchparty.rooms.active", activeRooms, AtomicLong::get)
                .description("Open rooms, as of the last snapshot sweep")
                .register(registry);
        Gauge.builder("watchparty.ws.sessions", sessions, SessionRegistry::size)
                .description("WebSocket sessions held by this instance")
                .register(registry);

        this.applyScript = Timer.builder("watchparty.redis.apply")
                .description("Latency of the Lua script that sequences and stores a playback event")
                .register(registry);
        this.drift = DistributionSummary.builder("watchparty.sync.drift")
                .description("Absolute distance between a member's reported position and the projection")
                .baseUnit("milliseconds")
                .register(registry);
        this.assistantReply = Timer.builder("watchparty.ai.reply")
                .description("How long the room assistant's model takes to answer")
                .register(registry);
    }

    public void setActiveRooms(long count) {
        activeRooms.set(count);
    }

    public <T> T timeApply(Supplier<T> call) {
        return applyScript.record(call);
    }

    public void recordDrift(long driftMs) {
        drift.record(Math.abs(driftMs));
    }

    /** One of rate, seek or resync; see the ladder in frontend/src/lib/player.ts. */
    public void correction(String tier, int count) {
        if (count > 0) {
            Counter.builder("watchparty.sync.corrections").tag("tier", tier).register(registry).increment(count);
        }
    }

    /** result is "accepted" or the rejection code. */
    public void playbackEvent(String action, String result) {
        Counter.builder("watchparty.playback.events")
                .tag("action", action)
                .tag("result", result)
                .register(registry)
                .increment();
    }

    public void chatMessage() {
        registry.counter("watchparty.chat.messages").increment();
    }

    public void reaction() {
        registry.counter("watchparty.reactions").increment();
    }

    /** outcome is transferred, host_returned or no_candidate. */
    public void hostFailover(String outcome) {
        registry.counter("watchparty.host.failovers", "outcome", outcome).increment();
    }

    /** reason is host, empty or expired. */
    public void roomClosed(String reason) {
        registry.counter("watchparty.rooms.closed", "reason", reason).increment();
    }

    public void memberKicked() {
        registry.counter("watchparty.members.kicked").increment();
    }

    public void queueAdvanced(String reason) {
        registry.counter("watchparty.queue.advanced", "reason", reason).increment();
    }

    /**
     * One "@ai" in a chat. result is answered, empty (the model had no reply),
     * quota (the model's own rate limit), failed, limited (a member or room
     * asking too often), budget (the deployment's allowance), busy or off.
     */
    public void assistantRequest(String result) {
        registry.counter("watchparty.ai.requests", "result", result).increment();
    }

    /** What an answer cost against the model's token limits. */
    public void assistantTokens(long prompt, long completion) {
        registry.counter("watchparty.ai.tokens", "type", "prompt").increment(prompt);
        registry.counter("watchparty.ai.tokens", "type", "completion").increment(completion);
    }

    /** From the question being picked up to the model's reply. */
    public void assistantReply(Duration took) {
        assistantReply.record(took);
    }
}
