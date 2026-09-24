package com.watchparty.security;

public enum PrincipalKind {
    /** A registered account. */
    USER,
    /** An anonymous guest, scoped to a single room. */
    GUEST
}
