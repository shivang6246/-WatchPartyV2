package com.watchparty.room;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomMemberRepository extends JpaRepository<RoomMember, UUID> {

    Optional<RoomMember> findByRoomIdAndUserId(UUID roomId, UUID userId);

    Optional<RoomMember> findByRoomIdAndGuestId(UUID roomId, UUID guestId);

    List<RoomMember> findByRoomIdAndRemovedFalseOrderByJoinedAtAsc(UUID roomId);

    long countByRoomIdAndLeftAtIsNullAndRemovedFalse(UUID roomId);

    /** The rooms a member has been in, for the "jump back in" row. */
    List<RoomMember> findByUserIdAndRemovedFalse(UUID userId);
}
