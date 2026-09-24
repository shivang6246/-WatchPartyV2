package com.watchparty.security;

import java.security.Principal;
import java.util.UUID;

/**
 * The caller's identity. A JWT proves who the caller is; it never proves what
 * they may do inside a room — that is always a room_member lookup.
 *
 * @param roomId set only for guests, whose identity is scoped to one room
 */
public record AuthPrincipal(UUID id, PrincipalKind kind, String displayName, UUID roomId) implements Principal {

    @Override
    public String getName() {
        return kind.name().toLowerCase() + ":" + id;
    }

    public boolean isGuest() {
        return kind == PrincipalKind.GUEST;
    }

    public UUID userId() {
        return kind == PrincipalKind.USER ? id : null;
    }

    public UUID guestId() {
        return kind == PrincipalKind.GUEST ? id : null;
    }
}
