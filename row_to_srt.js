function getTimeStamp(minute, second, frame, frameRate) {
    if (frameRate === void 0) { frameRate = 30; }
    var minuteNumber = Number.parseInt(minute + "");
    var secondNumber = Math.floor(Number.parseFloat(second + ""));
    var miliseconds = Math.round(1000 * (Number.parseFloat(second + "") % 1));
    if (frame && (frame + "").length > 0) {
        var frameNumber = Number.parseInt(frame + "");
        miliseconds = 1000 * (frameNumber / frameRate);
    }
    if (miliseconds >= 1000) {
        miliseconds = 999;
    }
    var dateNumber = minuteNumber * 60000 + secondNumber * 1000 + miliseconds;
    return dateFormat(dateNumber, "HH:MM:ss,l");
}
function rowsToSRT(rows) {
    var srtOutput = "";
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        // Time stamps
        var startTimeStamp = getTimeStamp(row.startTimeMinute, row.startTimeSecond, row.startTimeFrame);
        var endTimeStamp = getTimeStamp(row.endTimeMinute, row.endTimeSecond, row.endTimeFrame);
        var text = row.text ? row.text : "";
        if (text.indexOf("\n") > -1) {
            text = text.split("\n")
                .map(function (line) { return "- " + line; })
                .join("\n");
        }
        srtOutput += (i + 1) + "\n" + startTimeStamp + " --> " + endTimeStamp + "\n" + text + "\n\n";
    }
    return srtOutput;
}
