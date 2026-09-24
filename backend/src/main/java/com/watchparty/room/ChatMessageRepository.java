package com.watchparty.room;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {

    /** Keyset paging backwards from a cursor, matching the room/time index. */
    List<ChatMessage> findByRoomIdAndCreatedAtBeforeOrderByCreatedAtDesc(
            UUID roomId, Instant before, Pageable pageable);

    /** One statement, rather than the load-then-delete-each a derived delete does. */
    @Transactional
    @Modifying
    @Query("delete from ChatMessage m where m.roomId = :roomId")
    int deleteByRoomId(@Param("roomId") UUID roomId);
}
