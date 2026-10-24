-- Cover room/participant foreign keys used during cleanup and recovery.
create index round_players_player_room_idx on app_private.round_players(player_id,room_id);
create index round_players_round_room_idx on app_private.round_players(round_id,room_id);
create index command_receipts_player_room_idx on app_private.command_receipts(player_id,room_id);
create index rooms_host_room_idx on app_private.rooms(host_player_id,id);
