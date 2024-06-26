/**
 * @file Handles reading/parsing uploaded .CSV file according to certain restrictions. Sends processed data to 
 * assignment.js, then posts resulting data to the calendar and algorithm results pages.
 * Also sends data to the Calendar.js and AlgoResult.js pages.
 * @author Jacob Finley, Travis McMahon 
 * @namespace Restrictions
 */

import { CourseDescription, ClassroomTimeData, PriorityQueue, unassignableClasses, unassignableClassesSections } from './Class_Objects.js';
import fs from 'fs';
import { parse } from 'csv-parse';
import rooms from "./rooms.json" assert {type: "json"};
import { calendarFormat } from './formatCalendar.js';
import { assignRooms, Queueify, writeToCSV } from './assignment.js';
import winston from 'winston';

const { transports, format, createLogger } = winston;
const { combine, printf, timestamp } = format;

/* global variables */
export var classData = []; // will hold instances of classDescription, will end up with the data for all of the classes
export var unassignedClassData = []; // will hold instances of classDescription, will end up with the data for all of the classes
export var assignedClassData = []; // will hold instances of classDescription for classes that are assigned
var crossListedCoursesToCheck = []; // will temporarily hold classes that are cross listed and skip them if listed
export var roomsList = [];
export var classDayFrequencies = {'M': {},'T': {},'W': {},'R': {},'F': {},'S': {}}
export var classDayTotals = {'M': 0,'T': 0,'W': 0,'R': 0,'F': 0,'S': 0}
export const QUEUE = new PriorityQueue();
var finalUnassignedClasses = [];

export const logger = new createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
        timestamp({
          format: 'YYYY-MM-DD hh:mm:ss.SSS A',
        }),
        printf((info) => `[${info.timestamp}] ${info.level}: ${info.message}`)
      ),
    transports: [
      new transports.File({
        filename: './output/information.log',
      }),
    ],
});

/** Read data from uploaded CSV file
 * @function
 * @returns {void} resolved and parsed data from CSV
 * @memberof Restrictions
 */
function readCSVData(file_path) {
    return new Promise((resolve, reject) => {
        var prevClassName; // holds the previous class stated in csv file
        if (!fs.existsSync(file_path)) {
            logger.error("File not found");
            reject(new Error("File not found."));
            return;
        }
        const fileStream = fs.createReadStream(file_path);
        const parser = fileStream.pipe(parse({from_line: 4}));
        fileStream.on('error', (err) => {
            logger.error(err);
            reject(err);
        });
        parser.on('error', (err) => {
            logger.error(err);
            reject(err);
        });
        parser.on('data', (row) => {
            var crossListed;
            var cd = new CourseDescription(); // creates object to store class data
            if (Number(row[7]) >= 800) { /* bad section number */ } 
            else if (row[0] === '' 
                    && unassignableClasses.includes(prevClassName) 
                    && unassignableClassesSections[unassignableClasses.indexOf(prevClassName)].includes(row[7])) { /* class is unassignable with bad section number */ }
            else if (row[29] > 60 || row[35] > 60) { /* too many students to sit */ }
            else if (row[11].includes(";")) {
                logger.warn(`Cannot assign ${prevClassName} sect. ${row[7]} due to irregular meeting time. Please assign manually`);
            }
            else if (row[0] === '') {
                var crossListed = row[34] !== '' && cd.checkIfCrossListed([row[6], row[7]], row[34], crossListedCoursesToCheck);
                cd.setCourseName(prevClassName);
                cd.term = row[1];
                cd.termCode = row[2];
                cd.deptCode = row[3];
                cd.subjCode = row[4];
                cd.catNumber = row[5];
                cd.course = row[6];
                cd.setSectionNum(row[7]);
                cd.courseTitle = row[8];
                cd.sectionType = row[9];
                cd.setLab(row[9]);
                cd.topic = row[10];
                cd.spliceTime(row[11]);
                cd.meetingPattern = row[11];
                cd.meetings = row[12];
                cd.instructor = row[13];
                cd.setRoom(row[14]);
                cd.status = row[15];
                cd.setSession(row[16]);
                cd.campusCode = row[17];
                cd.setCampus(row[17]);
                cd.instMethod = row[18];
                cd.integPartner = row[19];
                cd.schedulePrint = row[20];
                cd.consent = row[21];
                cd.creditHrsMin = row[22];
                cd.creditHrs = row[23];
                cd.gradeMode = row[24];
                cd.attributes = row[25];
                cd.courseAttributes = row[26];
                cd.roomAttributes = row[27];
                cd.enrollment = row[28];
                cd.maxEnrollments = row[29];
                cd.priorEnrollment = row[30];
                cd.projEnrollment = row[31];
                cd.waitCap = row[32];
                cd.rmCapRequest = row[33];
                cd.crossListings = row[34];
                cd.setClassSize(row[29], row[35]);
                cd.crossListMax = row[35];
                cd.crossListProj = row[36];
                cd.crossListWaitCap = row[37];
                cd.crossListRmCapReq = row[38];
                cd.linkTo = row[39];
                cd.comments = row[40];
                cd.notes1 = row[41];
                cd.notes2 = row[42];
                if (crossListed) {
                    for (var _class of crossListedCoursesToCheck) {
                        
                    }
                }
                if (cd.room === null) {
                    unassignedClassData.push(cd);
                }
                else {
                    assignedClassData.push(cd);
                }
            }
            else { // will save the previous class name for the next row
                prevClassName = row[0];
            } // end of if statement
        });
        parser.on('end', () => {
            resolve(unassignedClassData);
        })
    }); // end of return
} // end of readCSVData

/** Primes room data for algorithm
 * @function
 * @returns {void} primed data in roomsList
 * @memberof Restrictions
 */
function createRoomData() {
    for (const key in rooms){
        var room = new ClassroomTimeData();
        room.roomNumber = key;
        room.colleges['CoE'] = rooms[key].Info['CoE'];
        room.colleges['IS&T'] = rooms[key].Info['IS&T'];
        room.roomSize = rooms[key].Seats;
        room.isLab = rooms[key].RoomType === "Lab" ? true : false;
        roomsList.push(room);
    }
}

/** Tests how many classes can be assigned per day
 * @function
 * @returns {void}
 * @memberof Restrictions
 */
function howManyClassesPerDay() {
    var total_count = 0;
    // loop through each class
    for (var _class of classData) {
        // loop through each of the meeting dates
        for (var ses of _class.meetingDates) {
            // loop through each day of the meeting dates
            var days = ses.days.split("");
            for (var day of days) {
                if (ses.start in classDayFrequencies[day]) {
                    classDayFrequencies[day][ses.start]++;
                }
                else {
                    classDayFrequencies[day][ses.start] = 1;
                }
                classDayTotals[day]++;
            }
        }
        total_count++;
    }
}

/**  Will compare two meeting dates, return types:
    -2 if stable is null
    -1 if test is earlier
    0  if during the same time 
    1  if stable is earlier
 * @function
 * @returns {void}
 * @memberof Restrictions
 */
export function compareMeetingDates(test, stable) { 
    if (stable === null) {
        return -2;
    }
    var parsedTest = {'startHour': null,
                        'startMin': null,
                        'endHour': null,
                        'endMin': null,
                        'startTotal': null,
                        'endTotal': null};
    var parsedStable = {'startHour': null,
                        'startMin': null,
                        'endHour': null,
                        'endMin': null,
                        'startTotal': null,
                        'endTotal': null};
    // splice the start hours
    var testSplit = test.start.slice(0, -2).split(":");
    var stableSplit = stable.start.slice(0, -2).split(":");
    // set start hours
    parsedTest.startHour = test.start.includes("pm") && parseInt(testSplit[0]) !== 12 
                            ? parseInt(testSplit[0]) + 12 : parseInt(testSplit[0]);
    parsedStable.startHour = stable.start.includes("pm") && parseInt(stableSplit[0]) !== 12 
                            ? parseInt(stableSplit[0]) + 12 : parseInt(stableSplit[0]);
    // set start minutes 
    parsedTest.startMin = isNaN(parseInt(testSplit[1])) ? 0 : parseInt(testSplit[1]);
    parsedStable.startMin = isNaN(parseInt(stableSplit[1])) ? 0 : parseInt(stableSplit[1]);
    // splice the end hours
    testSplit = test.end.slice(0, -2).split(":");
    stableSplit = stable.end.slice(0, -2).split(":");
    // set end hours
    parsedTest.endHour = test.end.includes("pm") && parseInt(testSplit[0]) !== 12 
                            ? parseInt(testSplit[0]) + 12 : parseInt(testSplit[0]);
    parsedStable.endHour = stable.end.includes("pm") && parseInt(stableSplit[0]) !== 12 
                            ? parseInt(stableSplit[0]) + 12 : parseInt(stableSplit[0]);
    // set start minutes 
    parsedTest.endMin = isNaN(parseInt(testSplit[1])) ? 0 : parseInt(testSplit[1]);
    parsedStable.endMin = isNaN(parseInt(stableSplit[1])) ? 0 : parseInt(stableSplit[1]);
    // set totals
    parsedTest.endTotal = parsedTest.endHour*60+parsedTest.endMin;
    parsedTest.startTotal = parsedTest.startHour*60+parsedTest.startMin;
    parsedStable.endTotal = parsedStable.endHour*60+parsedStable.endMin;
    parsedStable.startTotal = parsedStable.startHour*60+parsedStable.startMin;
    // during the same time
    if (parsedStable.startTotal <= parsedTest.startTotal && parsedTest.startTotal < parsedStable.endTotal ||
        parsedTest.startTotal <= parsedStable.startTotal && parsedStable.startTotal < parsedTest.endTotal) { return 0 }
    // date1 is earlier
    else if (parsedTest.endHour*60 + parsedTest.endMin <= parsedStable.startHour*60 + parsedStable.startMin) { return -1 }
    // date2 is earlier
    else if (parsedStable.endHour*60 + parsedStable.endMin <= parsedTest.startHour*60 + parsedTest.startMin) { return 1 }
    else { return null }
}

/** Main function for all classes
 * @function
 * @returns {void}
 * @memberof Restrictions
 */
export async function mainRestrictions(path) {
    await readCSVData(path);
    logger.info("Class data has been read");
    createRoomData();
    logger.info("Room information has been read");
    howManyClassesPerDay();
    logger.info("Number of classes per day has been calculated");
    Queueify();
    logger.info("Class data has been queued");
    assignRooms();
    logger.info("Finished assigning rooms");
    writeToCSV();
    logger.info("Data has been outputted");
    if (finalUnassignedClasses.length > 0) {
        for (var _class of finalUnassignedClasses) {
            logger.warn(`Class ${_class.name} section ${_class.sectionNumber} was not assigned a room`)
        }
        logger.warn(`A total number of ${finalUnassignedClasses.length} have not been assigned`);
    }
    else {
        logger.info("All classes have been assigned");
    }
    calendarFormat();
} // end of main

/* launch main */
// var test_path = './uploads/1710813723353_test.csv';
// mainRestrictions(uploadedFilePath);

export default {mainRestrictions};