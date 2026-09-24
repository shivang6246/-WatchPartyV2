package com.watchparty.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public final class AuthDtos {

    public record RegisterRequest(
            @Email @NotBlank String email,
            @NotBlank @Size(min = 8, max = 200) String password,
            @NotBlank @Size(max = 40) String displayName) {}

    public record LoginRequest(@Email @NotBlank String email, @NotBlank String password) {}

    /** Either the invite link's token or the room code; the code alone is enough. */
    public record GuestRequest(
            @Size(max = 64) String inviteToken, @Size(max = 12) String roomCode, @Size(max = 40) String displayName) {}

    public record UserView(
            UUID id,
            String email,
            String displayName,
            String avatarUrl,
            String provider,
            boolean emailVerified,
            /** False when nothing is held back by being unverified (no SMTP configured). */
            boolean verificationRequired) {}

    public record VerifyEmailRequest(@NotBlank String token) {}

    public record VerifyCodeRequest(@NotBlank @Size(max = 12) String code) {}

    /**
     * Finishes a sign-up: either the link's token, or the code together with
     * the address it was sent to (there is no session yet to tie it to).
     */
    public record ConfirmRegistrationRequest(
            @Size(max = 320) String email, @Size(max = 12) String code, @Size(max = 128) String token) {}

    public record ResendRegistrationRequest(@Email @NotBlank String email) {}

    /** Register's answer when the account waits on the emailed code. */
    public record PendingRegistrationResponse(String email, boolean pending) {}

    /**
     * The access token is returned in the body and kept in memory by the client;
     * the refresh token only ever travels as an HttpOnly cookie.
     */
    public record AuthResponse(String accessToken, long expiresInSeconds, UserView user) {}

    public record GuestResponse(String guestToken, UUID roomId, String roomCode, String displayName) {}

    public record GoogleIdTokenRequest(@NotBlank String idToken) {}

    private AuthDtos() {}
}
