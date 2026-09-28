package com.watchparty.friend;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FriendshipRepository extends JpaRepository<Friendship, UUID> {

    /** The pair's row, whichever of them asked. Pass the pair in {@link FriendService#pair} order. */
    Optional<Friendship> findByUserLowAndUserHigh(UUID userLow, UUID userHigh);

    /** Every friendship and request this account is part of. */
    @Query("select f from Friendship f where f.userLow = :userId or f.userHigh = :userId")
    List<Friendship> findInvolving(@Param("userId") UUID userId);
}
