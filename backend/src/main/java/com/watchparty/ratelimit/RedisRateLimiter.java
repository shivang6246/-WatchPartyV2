package com.watchparty.ratelimit;

import java.time.Duration;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

/**
 * Fixed-window counters held in Redis, so every app instance shares one quota.
 *
 * <p>Per-JVM buckets are the thing that silently breaks the moment a second
 * instance exists: each instance enforces its own limit, so the effective limit
 * multiplies by the instance count and a caller can multiply it again just by
 * reconnecting.
 */
@Component
public class RedisRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(RedisRateLimiter.class);

    /** Increments the window counter and returns [count, ttlMillis] atomically. */
    private static final String SCRIPT =
            """
            local count = redis.call('INCR', KEYS[1])
            if count == 1 then
              redis.call('PEXPIRE', KEYS[1], ARGV[1])
            end
            return {count, redis.call('PTTL', KEYS[1])}
            """;

    private final StringRedisTemplate redis;
    private final RedisScript<List> script;

    public RedisRateLimiter(StringRedisTemplate redis) {
        this.redis = redis;
        this.script = new DefaultRedisScript<>(SCRIPT, List.class);
    }

    /** @return the outcome; never throws, since a Redis blip should not take the app down */
    @SuppressWarnings("unchecked")
    public Decision consume(String bucket, String key, int limit, Duration window) {
        String redisKey = "ratelimit:" + bucket + ":" + key;
        try {
            List<Long> result =
                    (List<Long>) redis.execute(script, List.of(redisKey), String.valueOf(window.toMillis()));
            if (result == null || result.size() < 2) {
                return Decision.allow();
            }
            long count = result.get(0);
            long ttlMillis = Math.max(result.get(1), 0);
            return count > limit ? new Decision(false, Duration.ofMillis(ttlMillis)) : Decision.allow();
        } catch (RuntimeException ex) {
            // Fail open: losing Redis should degrade abuse control, not availability.
            log.warn("Rate limit check failed for {} ({}); allowing request", redisKey, ex.toString());
            return Decision.allow();
        }
    }

    public record Decision(boolean allowed, Duration retryAfter) {
        static Decision allow() {
            return new Decision(true, Duration.ZERO);
        }
    }
}
