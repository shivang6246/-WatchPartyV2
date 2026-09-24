package com.watchparty.room;

/** Where the video comes from, which decides what the client mounts. */
public enum Platform {
    /** YouTube IFrame Player API. Works on every device. */
    YOUTUBE("youtube"),
    /** A direct MP4/HLS URL the page owns as a plain video element. */
    HOSTED("hosted"),
    /** Vimeo embed SDK. */
    VIMEO("vimeo"),
    /** Netflix and friends: desktop Chrome extension only, no web playback. */
    DRM_EXTENSION("drm_extension");

    private final String value;

    Platform(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    public boolean playableOnWeb() {
        return this != DRM_EXTENSION;
    }

    public static Platform from(String raw) {
        for (Platform platform : values()) {
            if (platform.value.equalsIgnoreCase(raw) || platform.name().equalsIgnoreCase(raw)) {
                return platform;
            }
        }
        throw new IllegalArgumentException("Unknown platform: " + raw);
    }
}
