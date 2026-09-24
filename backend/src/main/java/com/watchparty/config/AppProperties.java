package com.watchparty.config;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(
        Jwt jwt,
        Refresh refresh,
        WsTicket wsTicket,
        Cors cors,
        Room room,
        Google google,
        YouTube youtube,
        Mail mail,
        Verification verification,
        Web web) {

    public record Jwt(String secret, String keyId, String issuer, Duration accessTtl, Duration guestTtl) {}

    public record Refresh(Duration ttl, String cookieName, boolean cookieSecure, String cookieDomain) {}

    public record WsTicket(Duration ttl) {}

    public record Cors(List<String> allowedOrigins, List<String> allowedExtensionIds) {}

    /**
     * @param hostGrace how long a disconnected host keeps the room before it
     *     passes to the longest-standing registered member still watching
     * @param emptyGrace how long a room with nobody connected stays open
     * @param maxQueue upper bound on queued videos per room
     */
    public record Room(
            int maxMembers,
            Duration ttl,
            long snapshotIntervalMs,
            Duration memberHeartbeatTtl,
            int retentionDays,
            Duration hostGrace,
            Duration emptyGrace,
            int maxQueue) {}

    /** Powers the in-app YouTube browser; search degrades to link-paste without a key. */
    public record YouTube(String apiKey, String region) {}

    /** The From address on transactional mail. SMTP itself is spring.mail.*. */
    public record Mail(String from) {}

    /**
     * @param ttl how long a verification link stays good
     * @param required null follows whether SMTP is configured: enforced where
     *     mail can be sent, relaxed on a machine that cannot send any
     */
    public record Verification(Duration ttl, Boolean required) {}

    /** Where the web client lives, for links inside emails. */
    public record Web(String baseUrl) {}

    public record Google(String clientId, String clientSecret, String redirectUri, String postLoginRedirect) {
        public boolean configured() {
            return clientId != null && !clientId.isBlank() && clientSecret != null && !clientSecret.isBlank();
        }
    }
}
