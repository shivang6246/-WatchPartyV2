package com.watchparty;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.watchparty.common.ApiException;
import com.watchparty.config.AppProperties;
import com.watchparty.security.AuthPrincipal;
import com.watchparty.security.JwtService;
import com.watchparty.security.PrincipalKind;
import com.watchparty.user.AppUser;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class JwtServiceTest {

    private static final String SECRET =
            Base64.getEncoder().encodeToString("a-test-secret-that-is-long-enough-32b".getBytes());

    private static JwtService service(String secret) {
        AppProperties props = new AppProperties(
                new AppProperties.Jwt(secret, "k1", "watchparty", Duration.ofMinutes(15), Duration.ofHours(24)),
                new AppProperties.Refresh(Duration.ofDays(30), "wp_refresh", true, ""),
                new AppProperties.WsTicket(Duration.ofSeconds(30)),
                new AppProperties.Cors(List.of("http://localhost:3000"), List.of()),
                new AppProperties.Room(25, Duration.ofHours(24), 30_000, Duration.ofSeconds(20), 30,
                        Duration.ofSeconds(45), Duration.ofMinutes(10), 50),
                new AppProperties.Google("", "", "", ""),
                new AppProperties.YouTube("", "US"),
                new AppProperties.Mail("WatchParty <no-reply@localhost>"),
                new AppProperties.Verification(Duration.ofHours(24), null),
                new AppProperties.Web("http://localhost:3000"));
        return new JwtService(props);
    }

    @Test
    void accessTokensRoundTripToAUserPrincipal() {
        JwtService jwt = service(SECRET);
        AppUser user = AppUser.local("someone@example.com", "hash", "Someone");

        AuthPrincipal principal = jwt.parse(jwt.issueAccessToken(user));

        assertThat(principal.kind()).isEqualTo(PrincipalKind.USER);
        assertThat(principal.id()).isEqualTo(user.getId());
        assertThat(principal.roomId()).isNull();
    }

    @Test
    void guestTokensCarryTheirRoomScope() {
        JwtService jwt = service(SECRET);
        UUID guestId = UUID.randomUUID();
        UUID roomId = UUID.randomUUID();

        AuthPrincipal principal = jwt.parse(jwt.issueGuestToken(guestId, roomId, "Alex"));

        assertThat(principal.isGuest()).isTrue();
        assertThat(principal.roomId()).isEqualTo(roomId);
        assertThat(principal.displayName()).isEqualTo("Alex");
    }

    @Test
    void tokensSignedWithAnotherKeyAreRejected() {
        JwtService mint = service(SECRET);
        JwtService other =
                service(Base64.getEncoder().encodeToString("a-different-secret-also-32-bytes!".getBytes()));
        String token = mint.issueAccessToken(AppUser.local("a@b.com", "hash", "A"));

        assertThatThrownBy(() -> other.parse(token)).isInstanceOf(ApiException.class);
    }

    @Test
    void shortSecretsFailAtStartupRatherThanSilently() {
        assertThatThrownBy(() -> service(Base64.getEncoder().encodeToString("too-short".getBytes())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("32 bytes");
    }

    @Test
    void urlSafeBase64SecretsFallBackToRawBytesInsteadOfCrashing() {
        // '_' and '-' are valid in URL-safe (base64url) output but not in
        // standard base64, and jjwt's decoder throws its own DecodingException
        // (not an IllegalArgumentException) on them. A secret shaped like this
        // must still start the app rather than fail the constructor.
        String urlSafeLooking = "a-test-secret_with-url-safe-characters_and-enough-length";
        JwtService jwt = service(urlSafeLooking);
        AppUser user = AppUser.local("someone@example.com", "hash", "Someone");

        AuthPrincipal principal = jwt.parse(jwt.issueAccessToken(user));

        assertThat(principal.id()).isEqualTo(user.getId());
    }
}
