package com.watchparty.common;

import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Transient;
import java.util.UUID;
import org.springframework.data.domain.Persistable;

/**
 * Entities whose UUID the application assigns at construction, so an id is
 * known before the row exists: a room's id goes into its host's member row,
 * a member's id into an event, before either is saved.
 *
 * <p>With an assigned id, Spring Data cannot tell a new entity from a
 * detached one and would merge (SELECT, then INSERT) every time. Tracking
 * "new" here makes a first save a plain INSERT, which is also what lets a
 * unique constraint catch two racing inserts.
 */
@MappedSuperclass
public abstract class AssignedIdEntity implements Persistable<UUID> {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id = UUID.randomUUID();

    @Transient
    private boolean fresh = true;

    @Override
    public UUID getId() {
        return id;
    }

    @Override
    public boolean isNew() {
        return fresh;
    }

    @PostLoad
    @PostPersist
    void markPersisted() {
        fresh = false;
    }
}
