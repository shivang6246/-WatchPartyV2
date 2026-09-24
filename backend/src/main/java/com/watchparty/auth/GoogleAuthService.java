package com.watchparty.auth;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.watchparty.common.ApiException;
import com.watchparty.config.AppProperties;
import com.watchparty.user.AppUser;
import com.watchparty.user.AppUserRepository;
import java.util.Collections;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

/**
 * Google sign-in.
 *
 * <p>Both the browser-side credential flow (an id token posted straight to us)
 * and the redirect flow (an authorization code we exchange) land on the same
 * verification and the same account upsert.
 */
@Service
public class GoogleAuthService {

    private static final Logger log = LoggerFactory.getLogger(GoogleAuthService.class);
    private static final String TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

    private final AppProperties props;
    private final AppUserRepository users;
    private final RestClient restClient = RestClient.create();

    public GoogleAuthService(AppProperties props, AppUserRepository users) {
        this.props = props;
        this.users = users;
    }

    public boolean configured() {
        return props.google().configured();
    }

    private void requireConfigured() {
        if (!configured()) {
            throw new ApiException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "google_not_configured",
                    "Google sign-in is not configured on this deployment.");
        }
    }

    /** Verifies an id token issued for this client and upserts the account. */
    public AppUser signInWithIdToken(String idTokenString) {
        requireConfigured();
        try {
            GoogleIdTokenVerifier verifier =
                    new GoogleIdTokenVerifier.Builder(new NetHttpTransport(), GsonFactory.getDefaultInstance())
                            .setAudience(Collections.singletonList(props.google().clientId()))
                            .build();
            GoogleIdToken idToken = verifier.verify(idTokenString);
            if (idToken == null) {
                throw ApiException.unauthorized("google_token_invalid", "That Google sign-in could not be verified.");
            }
            GoogleIdToken.Payload payload = idToken.getPayload();
            String subject = payload.getSubject();
            String email = payload.getEmail();
            String name = (String) payload.get("name");
            String picture = (String) payload.get("picture");
            return upsert(subject, email, name, picture);
        } catch (ApiException ex) {
            throw ex;
        } catch (Exception ex) {
            log.warn("Google id token verification failed", ex);
            throw ApiException.unauthorized("google_token_invalid", "That Google sign-in could not be verified.");
        }
    }

    /** Exchanges an authorization code from the redirect flow for an id token. */
    public AppUser signInWithCode(String code) {
        requireConfigured();
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("code", code);
        form.add("client_id", props.google().clientId());
        form.add("client_secret", props.google().clientSecret());
        form.add("redirect_uri", props.google().redirectUri());
        form.add("grant_type", "authorization_code");

        Map<?, ?> tokenResponse;
        try {
            tokenResponse = restClient
                    .post()
                    .uri(TOKEN_ENDPOINT)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(Map.class);
        } catch (RuntimeException ex) {
            log.warn("Google code exchange failed", ex);
            throw ApiException.unauthorized("google_exchange_failed", "Google sign-in could not be completed.");
        }
        if (tokenResponse == null || tokenResponse.get("id_token") == null) {
            throw ApiException.unauthorized("google_exchange_failed", "Google did not return an identity token.");
        }
        return signInWithIdToken(String.valueOf(tokenResponse.get("id_token")));
    }

    private AppUser upsert(String subject, String email, String name, String avatarUrl) {
        return users.findByProviderAndProviderId("google", subject).orElseGet(() -> {
            // An existing local account with the same address keeps its identity;
            // signing in with Google does not create a second one.
            AppUser existing = users.findByEmailIgnoreCase(email).orElse(null);
            if (existing != null) {
                return existing;
            }
            String displayName = (name == null || name.isBlank()) ? email.split("@")[0] : name;
            return users.save(AppUser.google(email, subject, displayName, avatarUrl));
        });
    }

    public String authorizationUrl(String state) {
        requireConfigured();
        return "https://accounts.google.com/o/oauth2/v2/auth"
                + "?client_id=" + java.net.URLEncoder.encode(props.google().clientId(), java.nio.charset.StandardCharsets.UTF_8)
                + "&redirect_uri=" + java.net.URLEncoder.encode(props.google().redirectUri(), java.nio.charset.StandardCharsets.UTF_8)
                + "&response_type=code&scope=openid%20email%20profile&state="
                + java.net.URLEncoder.encode(state, java.nio.charset.StandardCharsets.UTF_8);
    }

    public String postLoginRedirect() {
        return props.google().postLoginRedirect();
    }
}
