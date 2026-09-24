package com.watchparty.room;

import com.watchparty.common.ApiException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns a pasted URL into a platform and a provider reference.
 *
 * <p>v1 accepts URLs the user supplies and hosts nothing itself, which keeps
 * transcoding, egress and takedown handling out of scope entirely.
 */
public record VideoSource(Platform platform, String url, String ref) {

    private static final Pattern YOUTUBE_ID = Pattern.compile(
            "(?:youtube\\.com/(?:watch\\?(?:.*&)?v=|embed/|live/|shorts/)|youtu\\.be/)([A-Za-z0-9_-]{11})");

    private static final Pattern VIMEO_ID = Pattern.compile("vimeo\\.com/(?:video/)?(\\d+)");

    public static VideoSource resolve(Platform requested, String rawUrl) {
        if (requested == Platform.DRM_EXTENSION) {
            // The web client cannot drive a DRM player; the room still exists so
            // members can chat while the extension handles playback on desktop.
            return new VideoSource(Platform.DRM_EXTENSION, safeUrl(rawUrl), null);
        }
        if (rawUrl == null || rawUrl.isBlank()) {
            throw ApiException.badRequest("video_required", "A video URL is required for this platform.");
        }
        String url = safeUrl(rawUrl);

        return switch (requested) {
            case YOUTUBE -> {
                Matcher matcher = YOUTUBE_ID.matcher(url);
                if (!matcher.find()) {
                    throw ApiException.badRequest("youtube_url_invalid", "That does not look like a YouTube video URL.");
                }
                yield new VideoSource(Platform.YOUTUBE, url, matcher.group(1));
            }
            case VIMEO -> {
                Matcher matcher = VIMEO_ID.matcher(url);
                if (!matcher.find()) {
                    throw ApiException.badRequest("vimeo_url_invalid", "That does not look like a Vimeo video URL.");
                }
                yield new VideoSource(Platform.VIMEO, url, matcher.group(1));
            }
            case HOSTED -> {
                String lower = url.toLowerCase(Locale.ROOT);
                boolean looksPlayable = lower.contains(".mp4")
                        || lower.contains(".webm")
                        || lower.contains(".m3u8")
                        || lower.contains(".mov")
                        || lower.contains(".mpd");
                if (!looksPlayable) {
                    throw ApiException.badRequest(
                            "hosted_url_invalid", "Link directly to an MP4, WebM or HLS (.m3u8) file.");
                }
                yield new VideoSource(Platform.HOSTED, url, null);
            }
            default -> throw ApiException.badRequest("platform_invalid", "Unsupported platform.");
        };
    }

    /** Only http(s) ever reaches a client, so a URL can never become a script vector. */
    private static String safeUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            return null;
        }
        String trimmed = rawUrl.trim();
        try {
            URI uri = new URI(trimmed);
            String scheme = uri.getScheme();
            if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
                throw ApiException.badRequest("url_invalid", "Only http and https URLs are accepted.");
            }
            if (uri.getHost() == null) {
                throw ApiException.badRequest("url_invalid", "That URL has no host.");
            }
            return trimmed;
        } catch (URISyntaxException ex) {
            throw ApiException.badRequest("url_invalid", "That URL could not be parsed.");
        }
    }
}
