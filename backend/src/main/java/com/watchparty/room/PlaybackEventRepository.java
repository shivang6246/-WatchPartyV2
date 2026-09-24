package com.watchparty.room;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface PlaybackEventRepository extends JpaRepository<PlaybackEventEntity, UUID> {

    @Transactional
    @Modifying
    @Query("delete from PlaybackEventEntity e where e.roomId = :roomId")
    int deleteByRoomId(@Param("roomId") UUID roomId);
}
