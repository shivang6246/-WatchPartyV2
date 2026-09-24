package com.watchparty.room;

public enum MemberRole {
    HOST("host"),
    MEMBER("member");

    private final String value;

    MemberRole(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    public static MemberRole from(String raw) {
        return HOST.value.equalsIgnoreCase(raw) ? HOST : MEMBER;
    }
}
