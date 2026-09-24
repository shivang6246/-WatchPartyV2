package com.watchparty.auth;

import com.watchparty.auth.AuthDtos.AuthResponse;
import com.watchparty.auth.AuthDtos.ConfirmRegistrationRequest;
import com.watchparty.auth.AuthDtos.GoogleIdTokenRequest;
import com.watchparty.auth.AuthDtos.GuestRequest;
import com.watchparty.auth.AuthDtos.GuestResponse;
import com.watchparty.auth.AuthDtos.LoginRequest;
import com.watchparty.auth.AuthDtos.PendingRegistrationResponse;
import com.watchparty.auth.AuthDtos.RegisterRequest;
import com.watchparty.auth.AuthDtos.ResendRegistrationRequest;
import com.watchparty.auth.AuthDtos.UserView;
import com.watchparty.auth.AuthDtos.VerifyCodeRequest;
import com.watchparty.auth.AuthDtos.VerifyEmailRequest;
import com.watchparty.common.ApiException;
import com.watchparty.config.AppProperties;
import com.watchparty.room.Room;
import com.watchparty.room.RoomRepository;
import com.watchparty.room.RoomService;
import com.watchparty.security.AuthPrincipal;
import com.watchparty.security.JwtService;
import com.watchparty.user.AppUser;
import com.watchparty.user.AppUserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Credential exchange. The unversioned alias keeps the shipped extension working. */
@RestController
@RequestMapping({"/api/v1/auth", "/api/auth"})
public class AuthController {

    private final AuthService authService;
    private final EmailVerificationService verification;
    private final GoogleAuthService googleAuthService;
    private final RoomRepository rooms;
    private final JwtService jwtService;
    private final AppUserRepository users;
    private final AppProperties props;

    public AuthController(
            AuthService authService,
            EmailVerificationService verification,
            GoogleAuthService googleAuthService,
            RoomRepository rooms,
            JwtService jwtService,
            AppUserRepository users,
            AppProperties props) {
        this.authService = authService;
        this.verification = verification;
        this.googleAuthService = googleAuthService;
        this.rooms = rooms;
        this.jwtService = jwtService;
        this.users = users;
        this.props = props;
    }

    /**
     * Where verification is enforced this answers 202 with no session: the
     * account only exists once {@code /register/confirm} gets the emailed
     * code or link. Otherwise it signs the new account in straight away.
     */
    @PostMapping("/register")
    public ResponseEntity<?> register(
            @Valid @RequestBody RegisterRequest request,
            @AuthenticationPrincipal AuthPrincipal currentPrincipal) {
        // A guest who registers mid-room keeps their seat: the member row is
        // rebound rather than a second participant being created.
        AuthService.Registration registration = authService.register(request, currentPrincipal);
        if (registration.session() == null) {
            return ResponseEntity.accepted()
                    .body(new PendingRegistrationResponse(registration.pendingEmail(), true));
        }
        return respond(registration.session());
    }

    /** Creates the held account from its code or link, and signs it in. */
    @PostMapping("/register/confirm")
    public ResponseEntity<AuthResponse> confirmRegistration(@Valid @RequestBody ConfirmRegistrationRequest request) {
        return respond(authService.confirmRegistration(request));
    }

    /** A new code for a sign-up still waiting; answers the same whether or not one is. */
    @PostMapping("/register/resend")
    public ResponseEntity<Void> resendRegistration(@Valid @RequestBody ResendRegistrationRequest request) {
        authService.resendRegistration(request.email());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return respond(authService.login(request));
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(HttpServletRequest request) {
        return respond(authService.refresh(readRefreshCookie(request)));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request) {
        authService.logout(readRefreshCookie(request));
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, clearedRefreshCookie().toString())
                .build();
    }

    @GetMapping("/me")
    public UserView me(@AuthenticationPrincipal AuthPrincipal principal) {
        if (principal == null || principal.isGuest()) {
            throw ApiException.unauthorized("unauthenticated", "Sign in to see your account.");
        }
        AppUser user = users.findById(principal.id())
                .orElseThrow(() -> ApiException.unauthorized("unknown_user", "Account not found."));
        return authService.view(user);
    }

    /**
     * Redeems an emailed verification link. Open to anyone holding one: the
     * token is the proof, and the recipient may not be signed in on the device
     * where they opened their mail.
     */
    @PostMapping("/verify")
    public UserView verifyEmail(@Valid @RequestBody VerifyEmailRequest request) {
        return authService.view(verification.verify(request.token()));
    }

    /**
     * Redeems the six-digit code from the same email. Signed in, unlike the
     * link: six digits is small enough that it has to be tied to one account.
     */
    @PostMapping("/verify/code")
    public UserView verifyCode(
            @AuthenticationPrincipal AuthPrincipal principal, @Valid @RequestBody VerifyCodeRequest request) {
        if (principal == null || principal.isGuest()) {
            throw ApiException.unauthorized("unauthenticated", "Sign in to confirm your address.");
        }
        AppUser user = users.findById(principal.id())
                .orElseThrow(() -> ApiException.unauthorized("unknown_user", "Account not found."));
        return authService.view(verification.verifyCode(user, request.code()));
    }

    /** Sends a fresh link, retiring the previous one. */
    @PostMapping("/verify/resend")
    public ResponseEntity<Void> resendVerification(@AuthenticationPrincipal AuthPrincipal principal) {
        if (principal == null || principal.isGuest()) {
            throw ApiException.unauthorized("unauthenticated", "Sign in to ask for a new link.");
        }
        AppUser user = users.findById(principal.id())
                .orElseThrow(() -> ApiException.unauthorized("unknown_user", "Account not found."));
        authService.resendVerification(user);
        return ResponseEntity.noContent().build();
    }

    /**
     * Issues a guest pass for one room, found by its invite link or by its
     * code alone. This is the only credential a guest needs. Guessing codes is
     * slowed by the per-IP GUEST_ISSUE limit.
     */
    @PostMapping("/guest")
    public GuestResponse guest(@Valid @RequestBody GuestRequest request) {
        Room room;
        if (request.inviteToken() != null && !request.inviteToken().isBlank()) {
            room = rooms.findByInviteToken(request.inviteToken())
                    .orElseThrow(() -> ApiException.forbidden("invite_invalid", "That invite link is not valid."));
        } else if (request.roomCode() != null && !request.roomCode().isBlank()) {
            room = rooms.findByRoomCodeAndActiveTrue(request.roomCode().trim().toUpperCase())
                    .orElseThrow(() -> ApiException.notFound("No open room with that code."));
        } else {
            throw ApiException.badRequest("room_required", "A room code or invite link is required.");
        }
        if (!room.isActive()) {
            throw ApiException.conflict("room_closed", "That room has closed.");
        }
        String displayName = (request.displayName() == null || request.displayName().isBlank())
                ? "Guest"
                : request.displayName().trim();
        UUID guestId = UUID.randomUUID();
        String token = jwtService.issueGuestToken(guestId, room.getId(), displayName);
        return new GuestResponse(token, room.getId(), room.getRoomCode(), displayName);
    }

    @PostMapping("/google")
    public ResponseEntity<AuthResponse> google(@Valid @RequestBody GoogleIdTokenRequest request) {
        AppUser user = googleAuthService.signInWithIdToken(request.idToken());
        return respond(authService.session(user));
    }

    @GetMapping("/google/start")
    public ResponseEntity<Void> googleStart() {
        return ResponseEntity.status(302)
                .location(URI.create(googleAuthService.authorizationUrl(RoomService.randomToken())))
                .build();
    }

    /**
     * Redirect-flow callback. The refresh cookie is set here and the browser is
     * sent back to the web app, which immediately calls refresh to pick up an
     * access token.
     */
    @GetMapping("/google/callback")
    public ResponseEntity<Void> googleCallback(@RequestParam("code") String code) {
        AppUser user = googleAuthService.signInWithCode(code);
        AuthService.Session session = authService.session(user);
        return ResponseEntity.status(302)
                .header(HttpHeaders.SET_COOKIE, refreshCookie(session.refreshToken()).toString())
                .location(URI.create(googleAuthService.postLoginRedirect()))
                .build();
    }

    // ---- Cookie plumbing --------------------------------------------------

    private ResponseEntity<AuthResponse> respond(AuthService.Session session) {
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshCookie(session.refreshToken()).toString())
                .body(session.response());
    }

    private ResponseCookie refreshCookie(String value) {
        ResponseCookie.ResponseCookieBuilder builder = ResponseCookie.from(props.refresh().cookieName(), value)
                .httpOnly(true)
                .secure(props.refresh().cookieSecure())
                // Strict is what stops a cross-site request from spending a
                // rotation and silently ending someone's session.
                .sameSite("Strict")
                .path("/api")
                .maxAge(props.refresh().ttl());
        if (props.refresh().cookieDomain() != null && !props.refresh().cookieDomain().isBlank()) {
            builder.domain(props.refresh().cookieDomain());
        }
        return builder.build();
    }

    private ResponseCookie clearedRefreshCookie() {
        return ResponseCookie.from(props.refresh().cookieName(), "")
                .httpOnly(true)
                .secure(props.refresh().cookieSecure())
                .sameSite("Strict")
                .path("/api")
                .maxAge(0)
                .build();
    }

    private String readRefreshCookie(HttpServletRequest request) {
        if (request.getCookies() == null) {
            return null;
        }
        for (var cookie : request.getCookies()) {
            if (props.refresh().cookieName().equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }
}
