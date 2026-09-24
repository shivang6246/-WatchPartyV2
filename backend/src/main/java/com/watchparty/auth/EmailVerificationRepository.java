package com.watchparty.auth;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface EmailVerificationRepository extends JpaRepository<EmailVerification, UUID> {

    Optional<EmailVerification> findByTokenHash(String tokenHash);

    /**
     * Spends a link in one statement, guarded on it still being usable, so a
     * link forwarded to someone else cannot be redeemed twice.
     *
     * @return 1 if this call spent it, 0 otherwise
     */
    @Transactional
    @Modifying
    @Query("""
            update EmailVerification v set v.usedAt = :now
            where v.tokenHash = :hash and v.usedAt is null and v.expiresAt > :now
            """)
    int spend(@Param("hash") String tokenHash, @Param("now") Instant now);

    /**
     * Spends a row by its six-digit code, for the account that owns it. Same
     * guard as the link, plus a cap on how many wrong codes that row survives.
     *
     * @return 1 if this call spent it, 0 otherwise
     */
    @Transactional
    @Modifying
    @Query("""
            update EmailVerification v set v.usedAt = :now
            where v.userId = :userId and v.codeHash = :hash and v.usedAt is null
              and v.expiresAt > :now and v.attempts < :maxAttempts
            """)
    int spendByCode(
            @Param("userId") UUID userId,
            @Param("hash") String codeHash,
            @Param("now") Instant now,
            @Param("maxAttempts") int maxAttempts);

    /** Counts a wrong code against the live row, so guessing runs out. */
    @Transactional
    @Modifying
    @Query("update EmailVerification v set v.attempts = v.attempts + 1 where v.userId = :userId and v.usedAt is null")
    int countFailedAttempt(@Param("userId") UUID userId);

    /** The link the account is currently expected to use, for attempt checks. */
    Optional<EmailVerification> findFirstByUserIdAndUsedAtIsNullOrderByCreatedAtDesc(UUID userId);

    /** Issuing a new link retires the older ones for that account. */
    @Transactional
    @Modifying
    @Query("delete from EmailVerification v where v.userId = :userId and v.usedAt is null")
    int deleteUnusedFor(@Param("userId") UUID userId);

    @Transactional
    @Modifying
    @Query("delete from EmailVerification v where v.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") Instant cutoff);
}
