package com.watchparty.room;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RoomMemberRepository extends JpaRepository<RoomMember, UUID> {

    Optional<RoomMember> findByRoomIdAndUserId(UUID roomId, UUID userId);

    Optional<RoomMember> findByRoomIdAndGuestId(UUID roomId, UUID guestId);

    List<RoomMember> findByRoomIdAndRemovedFalseOrderByJoinedAtAsc(UUID roomId);

    long countByRoomIdAndLeftAtIsNullAndRemovedFalse(UUID roomId);

    /** The rooms a member has been in, for the "jump back in" row. */
    List<RoomMember> findByUserIdAndRemovedFalse(UUID userId);

    /**
     * These accounts' memberships of rooms that are still open, in one query:
     * where friends might be watching. Presence then says whether they are.
     */
    @Query("select m from RoomMember m, Room r where m.roomId = r.id and r.active = true"
            + " and m.removed = false and m.userId in :userIds")
    List<RoomMember> findOpenByUserIds(@Param("userIds") Collection<UUID> userIds);
}
