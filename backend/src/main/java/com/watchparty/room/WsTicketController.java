package com.watchparty.room;

import com.watchparty.room.RoomDtos.WsTicketRequest;
import com.watchparty.room.RoomDtos.WsTicketResponse;
import com.watchparty.security.AuthPrincipal;
import com.watchparty.security.WsTicketService;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Hands out the single-use value the client presents in its STOMP CONNECT
 * frame, so no token ever travels in a WebSocket URL.
 */
@RestController
@RequestMapping({"/api/v1/ws-ticket", "/api/ws-ticket"})
public class WsTicketController {

    private final WsTicketService tickets;
    private final RoomService roomService;

    public WsTicketController(WsTicketService tickets, RoomService roomService) {
        this.tickets = tickets;
        this.roomService = roomService;
    }

    @PostMapping
    public WsTicketResponse issue(
            @AuthenticationPrincipal AuthPrincipal principal, @Valid @RequestBody WsTicketRequest request) {
        // Membership is checked here, so a ticket can only ever open a session
        // for a room the caller already belongs to.
        Room room = roomService.requireRoomById(request.roomId());
        roomService.requireMember(room.getId(), principal);
        WsTicketService.Issued issued = tickets.issue(principal, room.getId());
        return new WsTicketResponse(issued.ticket(), issued.expiresInSeconds());
    }
}
