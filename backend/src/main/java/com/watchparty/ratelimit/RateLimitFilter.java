package com.watchparty.ratelimit;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.watchparty.common.ErrorResponse;
import com.watchparty.ratelimit.RateLimits.Policy;
import com.watchparty.security.AuthPrincipal;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Applies the per-surface HTTP limits. Realtime limits live in the STOMP layer. */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private final RedisRateLimiter limiter;
    private final ObjectMapper objectMapper;
    private static final java.util.regex.Pattern ROOM_PREVIEW =
            java.util.regex.Pattern.compile("/rooms/[^/]+/preview");

    private static final java.util.regex.Pattern VERSION_PREFIX =
            java.util.regex.Pattern.compile("^/api(/v[0-9]+)?");

    public RateLimitFilter(RedisRateLimiter limiter, ObjectMapper objectMapper) {
        this.limiter = limiter;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        for (Policy policy : policiesFor(request)) {
            var decision = limiter.consume(policy.bucket(), keyFor(policy, request), policy.limit(), policy.window());
            if (!decision.allowed()) {
                long retryAfter = Math.max(1, decision.retryAfter().toSeconds());
                response.setStatus(429);
                response.setHeader("Retry-After", String.valueOf(retryAfter));
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                objectMapper.writeValue(
                        response.getOutputStream(),
                        ErrorResponse.of("rate_limited", "Too many requests. Retry in " + retryAfter + "s."));
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private List<Policy> policiesFor(HttpServletRequest request) {
        // The unversioned aliases are the same surfaces, so they have to carry
        // the same limits; otherwise a caller just drops /v1 to escape them.
        String surface = surfaceOf(request.getRequestURI());

        if ("GET".equals(request.getMethod())) {
            if (surface.startsWith("/catalog/")) {
                return List.of(RateLimits.CATALOG_SEARCH);
            }
            return ROOM_PREVIEW.matcher(surface).matches() ? List.of(RateLimits.ROOM_LOOKUP) : List.of();
        }
        if (!"POST".equals(request.getMethod())) {
            return List.of();
        }

        return switch (surface) {
            case "/auth/login", "/auth/register" -> List.of(RateLimits.LOGIN_BURST, RateLimits.LOGIN_HOURLY);
            case "/auth/guest" -> List.of(RateLimits.GUEST_ISSUE);
            case "/auth/verify", "/auth/verify/code", "/auth/register/confirm" -> List.of(RateLimits.VERIFY_ATTEMPT);
            case "/auth/register/resend" -> List.of(RateLimits.VERIFY_SEND);
            case "/auth/verify/resend" -> List.of(RateLimits.VERIFY_SEND);
            case "/rooms" -> List.of(RateLimits.ROOM_CREATE);
            case "/ws-ticket" -> List.of(RateLimits.WS_TICKET);
            default -> List.of();
        };
    }

    /** Strips the /api and /api/v{n} prefixes so both spellings match one rule. */
    private static String surfaceOf(String path) {
        String trimmed = path.endsWith("/") && path.length() > 1 ? path.substring(0, path.length() - 1) : path;
        return VERSION_PREFIX.matcher(trimmed).replaceFirst("");
    }

    private String keyFor(Policy policy, HttpServletRequest request) {
        if (policy.key() == RateLimits.Key.PRINCIPAL) {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getPrincipal() instanceof AuthPrincipal principal) {
                return principal.getName();
            }
        }
        return clientIp(request);
    }

    /**
     * {@code server.forward-headers-strategy=framework} already resolves
     * X-Forwarded-For into the remote address behind the proxy.
     */
    private String clientIp(HttpServletRequest request) {
        String addr = request.getRemoteAddr();
        return addr == null ? "unknown" : addr;
    }
}
