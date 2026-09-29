/**
 * Port du moteur de dates de JTAppleCalendar (MIT).
 * Source : https://github.com/patchthecode/JTAppleCalendar
 * Copyright (c) 2016-2020 JTAppleCalendar
 *
 * Reprise de ConfigurationParameters, JTAppleDateConfigGenerator
 * (setupMonthInfoDataForStartAndEndDate, numberOfInDatesForMonth)
 * et dateOwnerInfoFromPath.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software to deal in the Software without restriction. The software is
 * provided "as is", without warranty of any kind.
 */

export const MAX_DAYS_IN_WEEK = 7;
export const MAX_ROWS_PER_MONTH = 6;

export const OutDateCellGeneration = {
  tillEndOfRow: 'tillEndOfRow',
  tillEndOfGrid: 'tillEndOfGrid',
  off: 'off',
};

export const InDateCellGeneration = {
  forFirstMonthOnly: 'forFirstMonthOnly',
  forAllMonths: 'forAllMonths',
  off: 'off',
};

export const DateOwner = {
  thisMonth: 'thisMonth',
  previousMonthWithinBoundary: 'previousMonthWithinBoundary',
  previousMonthOutsideBoundary: 'previousMonthOutsideBoundary',
  followingMonthWithinBoundary: 'followingMonthWithinBoundary',
  followingMonthOutsideBoundary: 'followingMonthOutsideBoundary',
};

/** Dimanche = 1, comme Calendar.Component.weekday. */
export const DaysOfWeek = {
  sunday: 1,
  monday: 2,
  tuesday: 3,
  wednesday: 4,
  thursday: 5,
  friday: 6,
  saturday: 7,
};

const FIRST_DAY_CAL_VALUE = {
  monday: 6,
  tuesday: 5,
  wednesday: 4,
  thursday: 10,
  friday: 9,
  saturday: 8,
  sunday: 7,
};

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function noon(y, m, d) {
  return new Date(y, m, d, 12, 0, 0, 0);
}

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(value) {
  if (value instanceof Date) return noon(value.getFullYear(), value.getMonth(), value.getDate());
  const [y, m, d] = String(value).split('-').map(Number);
  return noon(y, (m || 1) - 1, d || 1);
}

export function addDays(date, n) {
  return noon(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

export function startOfMonth(date) {
  return noon(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date) {
  return noon(date.getFullYear(), date.getMonth() + 1, 0);
}

export function daysInMonth(date) {
  return endOfMonth(date).getDate();
}

export function shiftMonthKeepingDay(date, delta) {
  const src = date instanceof Date ? date : parseISODate(date);
  const target = noon(src.getFullYear(), src.getMonth() + delta, 1);
  const dim = daysInMonth(target);
  return noon(target.getFullYear(), target.getMonth(), Math.min(src.getDate(), dim));
}

/** Même décalage que numberOfInDatesForMonth (premier jour de semaine configurable). */
export function numberOfInDatesForMonth(date, firstDayOfWeek = 'monday') {
  const firstWeekdayOfMonthIndex = date.getDay();
  const firstDayCalValue = FIRST_DAY_CAL_VALUE[firstDayOfWeek] ?? 7;
  return (firstWeekdayOfMonthIndex + firstDayCalValue) % MAX_DAYS_IN_WEEK;
}

export function configurationParameters({
  startDate,
  endDate,
  numberOfRows = 6,
  generateInDates = InDateCellGeneration.forAllMonths,
  generateOutDates = OutDateCellGeneration.tillEndOfGrid,
  firstDayOfWeek = 'monday',
  hasStrictBoundaries,
} = {}) {
  const rows = numberOfRows > 0 && numberOfRows < 7 ? numberOfRows : 6;
  return {
    startDate: startOfMonth(startDate),
    endDate: endOfMonth(endDate),
    numberOfRows: rows,
    generateInDates,
    generateOutDates,
    firstDayOfWeek,
    hasStrictBoundaries: hasStrictBoundaries == null ? rows > 1 : !!hasStrictBoundaries,
  };
}

/** Mois : 6 rangées, in-dates tous les mois, out-dates jusqu’à la grille 6×7. */
export function monthConfiguration(startDate, endDate) {
  return configurationParameters({
    startDate,
    endDate,
    numberOfRows: 6,
    generateInDates: InDateCellGeneration.forAllMonths,
    generateOutDates: OutDateCellGeneration.tillEndOfGrid,
    firstDayOfWeek: 'monday',
    hasStrictBoundaries: true,
  });
}

/**
 * Semaine : 1 rangée, in-dates du premier mois seulement, out-dates coupées,
 * frontières souples pour ne pas répéter les jours.
 */
export function weekConfiguration(startDate, endDate) {
  return configurationParameters({
    startDate,
    endDate,
    numberOfRows: 1,
    generateInDates: InDateCellGeneration.forFirstMonthOnly,
    generateOutDates: OutDateCellGeneration.off,
    firstDayOfWeek: 'monday',
    hasStrictBoundaries: false,
  });
}

export function setupMonthInfoDataForStartAndEndDate(parameters) {
  const start = startOfMonth(parameters.startDate);
  const end = endOfMonth(parameters.endDate);
  const numberOfMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  const months = [];
  const monthMap = {};
  let section = 0;
  let startIndexForMonth = 0;
  let startCellIndexForMonth = 0;
  let totalDays = 0;
  const rowsWanted = parameters.numberOfRows;
  let monthNameIndex = start.getMonth();

  for (let monthIndex = 0; monthIndex < numberOfMonths; monthIndex += 1) {
    const currentMonthDate = noon(start.getFullYear(), start.getMonth() + monthIndex, 1);
    const numberOfDaysInMonthFixed = daysInMonth(currentMonthDate);
    let numberOfDaysInMonthVariable = numberOfDaysInMonthFixed;
    let numberOfPreDatesForThisMonth = 0;
    if (parameters.generateInDates !== InDateCellGeneration.off) {
      numberOfPreDatesForThisMonth = numberOfInDatesForMonth(currentMonthDate, parameters.firstDayOfWeek);
      numberOfDaysInMonthVariable += numberOfPreDatesForThisMonth;
      if (parameters.generateInDates === InDateCellGeneration.forFirstMonthOnly && monthIndex !== 0) {
        numberOfDaysInMonthVariable -= numberOfPreDatesForThisMonth;
        numberOfPreDatesForThisMonth = 0;
      }
    }

    let numberOfRowsToGenerateForCurrentMonth = 0;
    if (parameters.generateOutDates === OutDateCellGeneration.tillEndOfGrid) {
      numberOfRowsToGenerateForCurrentMonth = MAX_ROWS_PER_MONTH;
    } else {
      numberOfRowsToGenerateForCurrentMonth = Math.ceil(numberOfDaysInMonthVariable / MAX_DAYS_IN_WEEK);
    }

    let numberOfPostDatesForThisMonth = 0;
    if (
      parameters.generateOutDates === OutDateCellGeneration.tillEndOfGrid
      || parameters.generateOutDates === OutDateCellGeneration.tillEndOfRow
    ) {
      numberOfPostDatesForThisMonth = MAX_DAYS_IN_WEEK * numberOfRowsToGenerateForCurrentMonth
        - (numberOfDaysInMonthFixed + numberOfPreDatesForThisMonth);
      numberOfDaysInMonthVariable += numberOfPostDatesForThisMonth;
    }

    const sections = [];
    const sectionIndexMaps = {};
    for (let index = 0; index < 6; index += 1) {
      if (numberOfDaysInMonthVariable < 1) break;
      monthMap[section] = monthIndex;
      sectionIndexMaps[section] = index;
      let numberOfDaysInCurrentSection = rowsWanted * MAX_DAYS_IN_WEEK;
      if (numberOfDaysInCurrentSection > numberOfDaysInMonthVariable) {
        numberOfDaysInCurrentSection = numberOfDaysInMonthVariable;
      }
      totalDays += numberOfDaysInCurrentSection;
      sections.push(numberOfDaysInCurrentSection);
      numberOfDaysInMonthVariable -= numberOfDaysInCurrentSection;
      section += 1;
    }

    months.push({
      index: monthIndex,
      startDayIndex: startIndexForMonth,
      startCellIndex: startCellIndexForMonth,
      sections,
      inDates: numberOfPreDatesForThisMonth,
      outDates: numberOfPostDatesForThisMonth,
      sectionIndexMaps,
      rows: numberOfRowsToGenerateForCurrentMonth,
      name: MONTH_NAMES[monthNameIndex],
      numberOfDaysInMonth: numberOfDaysInMonthFixed,
    });
    startIndexForMonth += numberOfDaysInMonthFixed;
    startCellIndexForMonth += numberOfDaysInMonthFixed + numberOfPreDatesForThisMonth + numberOfPostDatesForThisMonth;
    monthNameIndex += 1;
    if (monthNameIndex > 11) monthNameIndex = 0;
  }

  return {
    months,
    monthMap,
    totalSections: section,
    totalDays,
    startOfMonthCache: start,
    endOfMonthCache: end,
  };
}

export function dateOwnerInfoFromPath(indexPath, info) {
  const monthIndex = info.monthMap[indexPath.section];
  if (monthIndex == null) return null;
  const monthData = info.months[monthIndex];
  const internal = monthData.sectionIndexMaps[indexPath.section];
  let offSet;
  let numberOfDaysToAddToOffset = 0;
  if (internal === 0) {
    offSet = monthData.inDates;
  } else {
    offSet = 0;
    numberOfDaysToAddToOffset = monthData.sections.slice(0, internal).reduce((sum, n) => sum + n, 0);
    numberOfDaysToAddToOffset -= monthData.inDates;
  }

  let dayIndex;
  let owner = DateOwner.thisMonth;
  const item = indexPath.item;
  if (item >= offSet && item + numberOfDaysToAddToOffset < monthData.numberOfDaysInMonth + offSet) {
    dayIndex = monthData.startDayIndex + item - offSet + numberOfDaysToAddToOffset;
  } else if (item < offSet) {
    dayIndex = item - offSet + monthData.startDayIndex;
    const date = addDays(info.startOfMonthCache, dayIndex);
    owner = date < info.startOfMonthCache
      ? DateOwner.previousMonthOutsideBoundary
      : DateOwner.previousMonthWithinBoundary;
    return { date, owner };
  } else {
    dayIndex = monthData.startDayIndex - offSet + item + numberOfDaysToAddToOffset;
    const date = addDays(info.startOfMonthCache, dayIndex);
    owner = date > info.endOfMonthCache
      ? DateOwner.followingMonthOutsideBoundary
      : DateOwner.followingMonthWithinBoundary;
    return { date, owner };
  }
  return { date: addDays(info.startOfMonthCache, dayIndex), owner };
}

export function buildCalendar(parameters) {
  const info = setupMonthInfoDataForStartAndEndDate(parameters);
  const cells = [];
  for (let section = 0; section < info.totalSections; section += 1) {
    const monthIndex = info.monthMap[section];
    const month = info.months[monthIndex];
    const internal = month.sectionIndexMaps[section];
    const itemCount = month.sections[internal];
    for (let item = 0; item < itemCount; item += 1) {
      const owned = dateOwnerInfoFromPath({ section, item }, info);
      cells.push({
        date: owned.date,
        key: isoDate(owned.date),
        owner: owned.owner,
        section,
        item,
        row: Math.floor(item / MAX_DAYS_IN_WEEK),
        column: item % MAX_DAYS_IN_WEEK,
        monthIndex,
        text: String(owned.date.getDate()),
      });
    }
  }
  return { ...info, parameters, cells };
}

export function monthCells(built, selected) {
  const key = isoDate(selected instanceof Date ? selected : parseISODate(selected));
  const hit = built.cells.find(cell => cell.key === key && cell.owner === DateOwner.thisMonth)
    || built.cells.find(cell => cell.key === key);
  if (!hit) return [];
  return built.cells.filter(cell => cell.monthIndex === hit.monthIndex);
}

export function weekCells(built, selected) {
  const key = isoDate(selected instanceof Date ? selected : parseISODate(selected));
  let index = built.cells.findIndex(cell => cell.key === key && cell.owner === DateOwner.thisMonth);
  if (index < 0) index = built.cells.findIndex(cell => cell.key === key);
  if (index < 0) return [];
  const start = index - (index % MAX_DAYS_IN_WEEK);
  return built.cells.slice(start, start + MAX_DAYS_IN_WEEK);
}

export function visibleCells(built, selected, numberOfRows) {
  return numberOfRows === 1 ? weekCells(built, selected) : monthCells(built, selected);
}

export function rangeAround(selected, monthsBefore = 12, monthsAfter = 12) {
  const anchor = selected instanceof Date ? selected : parseISODate(selected);
  return {
    startDate: noon(anchor.getFullYear(), anchor.getMonth() - monthsBefore, 1),
    endDate: endOfMonth(noon(anchor.getFullYear(), anchor.getMonth() + monthsAfter, 1)),
  };
}
