package com.watchparty.catalog;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

public final class CatalogDtos {

    /** One browsable item, whatever service it came from. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CatalogItem(
            String platform,
            String ref,
            String url,
            String title,
            String author,
            String thumbnail,
            Long durationMs,
            boolean live) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CatalogPage(List<CatalogItem> items, String nextPageToken, String notice) {}

    /** What the client needs in order to decide which source tiles to render. */
    public record SourceStatus(String id, String label, boolean browsable, boolean playableOnWeb, String note) {}

    private CatalogDtos() {}
}
