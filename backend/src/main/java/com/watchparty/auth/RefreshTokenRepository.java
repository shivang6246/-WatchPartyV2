package com.watchparty.auth;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    Optional<RefreshToken> findByTokenHash(String tokenHash);

    List<RefreshToken> findByFamilyId(UUID familyId);

    /**
     * Spends a token in one statement, guarded on it still being usable, so
     * two racing refreshes cannot both rotate it: one updates a row, the
     * other updates none and is treated as a replay.
     *
     * @return 1 if this call spent the token, 0 otherwise
     */
    @Transactional
    @Modifying
    @Query("""
            update RefreshToken t set t.usedAt = :now
            where t.tokenHash = :hash and t.usedAt is null and t.revokedAt is null and t.expiresAt > :now
            """)
    int spend(@Param("hash") String tokenHash, @Param("now") Instant now);

    @Transactional
    @Modifying
    @Query("update RefreshToken t set t.revokedAt = :now where t.familyId = :family and t.revokedAt is null")
    int revokeFamily(@Param("family") UUID familyId, @Param("now") Instant now);

    /** Postgres has no TTL index, so spent history is cleared by RetentionJob. */
    @Transactional
    @Modifying
    @Query("delete from RefreshToken t where t.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") Instant cutoff);
}
