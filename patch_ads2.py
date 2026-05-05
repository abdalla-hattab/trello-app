import re

with open('standalone/app.js', 'r') as f:
    content = f.read()

# 1. formatNameMap
content = content.replace("'ads': 'Ads', 'trelloSpeech': 'Trello Tracker 2'", "'ads': 'Ads', 'ads2': 'Ads Tracker 2', 'trelloSpeech': 'Trello Tracker 2'")

# 2. trackerType resolution
content = content.replace("trackerType === 'trello-speech' ? 'trelloSpeech' : trackerType", "trackerType === 'trello-speech' ? 'trelloSpeech' : (trackerType === 'ads2' ? 'ads2' : trackerType)")

# 3. "hasAdsTrackers" -> add hasAds2Trackers right after it in variable definitions
content = re.sub(
    r"(const hasAdsTrackers = [^\;]+\;)",
    r"\1\n            const hasAds2Trackers = activeBoard.connections && activeBoard.connections.some(c => c.source === list.id && c.sourcePort === edge && activeBoard.lists.find(l => l.id === c.target && l.trelloListId && l.trackerType === 'ads2'));",
    content
)

# 4. hasTrackersOnEdge
content = content.replace("hasAdsTrackers ||", "hasAdsTrackers || hasAds2Trackers ||")

# 5. edgeDict logic for 'ads' -> copy for 'ads2'
# There is a block starting with `if (hasAdsTrackers) {`
# We can find it using regex and duplicate it
ads_edge_block_pattern = r"if \(hasAdsTrackers\) \{[\s\S]*?(?=\n\s+if|\n\s+userOrder\.forEach)"
ads_edge_match = re.search(ads_edge_block_pattern, content)
if ads_edge_match:
    ads2_block = ads_edge_match.group(0)
    ads2_block = ads2_block.replace("hasAdsTrackers", "hasAds2Trackers")
    ads2_block = ads2_block.replace("edge + ':ads'", "edge + ':ads2'")
    ads2_block = ads2_block.replace("':ads'", "':ads2'")
    ads2_block = ads2_block.replace("'application/x-transfer-ads'", "'application/x-transfer-ads2'")
    ads2_block = ads2_block.replace("data-tracker-type=\"ads\"", "data-tracker-type=\"ads2\"")
    ads2_block = ads2_block.replace("edgeDict['ads']", "edgeDict['ads2']")
    # maybe change the stroke or fill slightly? Or keep identical? "exactly the same as Ads Tracker" so keep identical except ID.
    
    # insert after the original block
    content = content[:ads_edge_match.end()] + "\n                " + ads2_block + content[ads_edge_match.end():]

# 6. edgeOrder default
content = content.replace("['clientHappiness', 'moneySmelling', 'newClients', 'pipedrive', 'trello', 'trelloSpeech', 'ads']", "['clientHappiness', 'moneySmelling', 'newClients', 'pipedrive', 'trello', 'trelloSpeech', 'ads', 'ads2']")

# 7. tracker matching logic
content = content.replace("if (tType === 'ads' && tl.trackerType === 'ads') matches = true;", "if (tType === 'ads' && tl.trackerType === 'ads') matches = true;\n                            if (tType === 'ads2' && tl.trackerType === 'ads2') matches = true;")

content = content.replace("if (mappedType === 'ads') return t.trackerType === 'ads';", "if (mappedType === 'ads') return t.trackerType === 'ads';\n                        if (mappedType === 'ads2') return t.trackerType === 'ads2';")

content = content.replace("if (l.trackerType === 'ads') return 'ads';", "if (l.trackerType === 'ads') return 'ads';\n                if (l.trackerType === 'ads2') return 'ads2';")

# 8. Unlink Ads Tracker options
# Find `if (activeBoard.trelloBoardId && (list.trackerType === 'ads' || !list.trelloListId)) {`
# Duplicate the block for ads2
ads_unlink_pattern = r"if \(activeBoard\.trelloBoardId && \(list\.trackerType === 'ads' \|\| !list\.trelloListId\)\) \{[\s\S]*?(?=\n\s*if \(activeBoard\.trelloBoardId && \(list\.trackerType === 'trelloSpeech')"
ads_unlink_match = re.search(ads_unlink_pattern, content)
if ads_unlink_match:
    ads2_unlink_block = ads_unlink_match.group(0)
    ads2_unlink_block = ads2_unlink_block.replace("'ads'", "'ads2'")
    ads2_unlink_block = ads2_unlink_block.replace("'Ads Tracker'", "'Ads Tracker 2'")
    ads2_unlink_block = ads2_unlink_block.replace("'Ads Tracker Layout'", "'Ads Tracker 2 Layout'")
    ads2_unlink_block = ads2_unlink_block.replace("Set Ads Layout", "Set Ads 2 Layout")
    content = content[:ads_unlink_match.end()] + "\n        " + ads2_unlink_block + content[ads_unlink_match.end():]

# 9. List badge (tBadge)
ads_badge_pattern = r"if \(list\.trackerType === 'ads'\) \{[\s\S]*?(?=\} else if \(list\.trackerType === 'trelloSpeech'\) \{)"
ads_badge_match = re.search(ads_badge_pattern, content)
if ads_badge_match:
    ads2_badge_block = ads_badge_match.group(0).replace("'ads'", "'ads2'").replace("Ads Tracker", "Ads Tracker 2")
    content = content[:ads_badge_match.end()] + "} else " + ads2_badge_block + content[ads_badge_match.end():]

# 10. `trackerType === 'ads'` checks
content = content.replace("list.trackerType === 'ads' || list.trackerType === 'trelloSpeech'", "list.trackerType === 'ads' || list.trackerType === 'ads2' || list.trackerType === 'trelloSpeech'")
content = content.replace("list.trackerType === 'ads' || list.isPipedrive", "list.trackerType === 'ads' || list.trackerType === 'ads2' || list.isPipedrive")
content = content.replace("list.trackerType === 'ads' || !list.trelloListId", "list.trackerType === 'ads' || list.trackerType === 'ads2' || !list.trelloListId")
# Actually, the unlink block we duplicated already handles ads2 unlink. We don't need to change `ads` check in the ads unlink block, we just duplicated it. Oh wait, my replace might mess up the duplicated block if not careful. Let me just use regex carefully.

with open('standalone/app.js.new', 'w') as f:
    f.write(content)
