package com.watchparty.room;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RoomRepository extends JpaRepository<Room, UUID> {

    Optional<Room> findByRoomCodeAndActiveTrue(String roomCode);

    Optional<Room> findByInviteToken(String inviteToken);

    boolean existsByRoomCodeAndActiveTrue(String roomCode);

    List<Room> findByActiveTrueAndExpiresAtBefore(Instant cutoff);

    List<Room> findByActiveFalseAndClosedAtBefore(Instant cutoff);

    List<Room> findByActiveTrue();

    /** The open rooms among these, in one query: the home screen's list. */
    List<Room> findByIdInAndActiveTrue(Collection<UUID> ids);

    /** The rooms a signed-in user is hosting, newest first, for the home screen. */
    List<Room> findByHostUserIdAndActiveTrueOrderByUpdatedAtDesc(UUID hostUserId);

    /**
     * Loads a room with its row locked (SELECT ... FOR UPDATE) until the
     * surrounding transaction ends. Every write to an existing room goes
     * through this; see {@code RoomService.mutate}.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Room r where r.id = :id")
    Optional<Room> findByIdForUpdate(@Param("id") UUID id);
}
