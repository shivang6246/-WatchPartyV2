package com.watchparty.catalog;

import com.watchparty.catalog.CatalogDtos.CatalogItem;
import com.watchparty.catalog.CatalogDtos.CatalogPage;
import com.watchparty.catalog.CatalogDtos.SourceStatus;
import com.watchparty.room.Platform;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * What the "+" picker is built on: which sources exist, what can be browsed
 * in-app, and the search behind the in-app YouTube view.
 */
@RestController
@RequestMapping({"/api/v1/catalog", "/api/catalog"})
public class CatalogController {

    private final YouTubeCatalogService youtube;
    private final LinkResolver linkResolver;

    public CatalogController(YouTubeCatalogService youtube, LinkResolver linkResolver) {
        this.youtube = youtube;
        this.linkResolver = linkResolver;
    }

    /**
     * The source tiles. DRM services are listed rather than hidden: a member can
     * still join the room for chat, and saying so is better than pretending the
     * service does not exist.
     */
    @GetMapping("/sources")
    public List<SourceStatus> sources() {
        return List.of(
                new SourceStatus(
                        "youtube",
                        "YouTube",
                        youtube.searchAvailable(),
                        true,
                        youtube.searchAvailable() ? null : "Search needs a YouTube API key. Paste a link instead."),
                new SourceStatus("hosted", "Video link", false, true, "A direct MP4, WebM or HLS URL."),
                new SourceStatus("vimeo", "Vimeo", false, true, "Paste a Vimeo link."),
                new SourceStatus(
                        "drm_extension",
                        "Netflix, Prime Video, Disney+",
                        false,
                        false,
                        "DRM playback needs the desktop Chrome extension. The room still works for chat."));
    }

    @GetMapping("/youtube/search")
    public CatalogPage search(
            @RequestParam("q") String query,
            @RequestParam(name = "pageToken", required = false) String pageToken) {
        if (query == null || query.isBlank()) {
            return youtube.trending(null);
        }
        return youtube.search(query.trim(), pageToken);
    }

    @GetMapping("/youtube/trending")
    public CatalogPage trending(@RequestParam(name = "region", required = false) String region) {
        return youtube.trending(region);
    }

    /** Resolves a pasted link to a title and thumbnail, with no API key needed. */
    @GetMapping("/resolve")
    public CatalogItem resolve(
            @RequestParam("url") String url,
            @RequestParam(name = "platform", required = false) String platform) {
        Platform requested = platform == null || platform.isBlank() ? guess(url) : Platform.from(platform);
        return linkResolver.resolve(requested, url);
    }

    private static Platform guess(String url) {
        String lower = url == null ? "" : url.toLowerCase();
        if (lower.contains("youtube.com") || lower.contains("youtu.be")) {
            return Platform.YOUTUBE;
        }
        if (lower.contains("vimeo.com")) {
            return Platform.VIMEO;
        }
        return Platform.HOSTED;
    }
}
