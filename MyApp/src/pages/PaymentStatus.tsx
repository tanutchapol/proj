import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, RefreshControl, Modal, Pressable } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { BASE_HOST } from './config.ts';
import { apiFetchJson } from '../lib/api';
import debounce from 'lodash/debounce';
import { useI18n } from '../i18n';

type Props = { darkMode: boolean; onSelectHouse?: (houseNumber: string) => void };

type Status = 'paid' | 'pending' | 'overdue' | 'waiting_approval';

type Item = {
  houseNumber: string;
  status: Status;
};

type LatestInstallmentRow = {
  house_number: string;
  status: Status;                 // 'paid' | 'pending' | 'overdue' | 'waiting_approval'
  installment_no?: number;
  payment_id?: number;
  due_date?: string;
  period_start?: string;
  period_end?: string;
};
export function getBaseUrl() {
  return BASE_HOST;
}

const statusLabelKeys: Record<Status, string> = {
  paid: 'payStatusPaid',
  pending: 'payStatusPending',
  overdue: 'payStatusOverdue',
  waiting_approval: 'payStatusWaitingApproval',
};

const statusColor: Record<Status, string> = {
  paid: '#26C281',     // เขียว
  pending: '#FFD34D',  // เหลือง
  overdue: '#F05454',  // แดง
  waiting_approval: '#F59E0B', // สีเหลือง/ส้ม (Warning)
};

const statusTextColor: Record<Status, string> = {
  paid: '#073B1A',
  pending: '#5A4500',
  overdue: '#5E0000',
  waiting_approval: '#6B4200',
};

const MONTH_KEYS = [
  'monthFullJan', 'monthFullFeb', 'monthFullMar', 'monthFullApr', 'monthFullMay', 'monthFullJun',
  'monthFullJul', 'monthFullAug', 'monthFullSep', 'monthFullOct', 'monthFullNov', 'monthFullDec'
];

const PaymentStatus: React.FC<Props> = ({ darkMode, onSelectHouse }) => {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [searchText, setSearchText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);

  // Month/Year Selection
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1); // 1-12
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMonth, setPickerMonth] = useState<number>(now.getMonth() + 1);
  const [pickerYear, setPickerYear] = useState<number>(now.getFullYear());
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [yearPageStart, setYearPageStart] = useState<number>(now.getFullYear() - 4);

  // Stats
  const counts = useMemo(() => {
    return items.reduce(
      (acc, cur) => {
        acc[cur.status] += 1; return acc;
      },
      { paid: 0, pending: 0, overdue: 0, waiting_approval: 0 } as Record<Status, number>
    );
  }, [items]);

  const colors = {
    bg: darkMode ? '#0E0E0E' : '#FFFFFF',
    text: darkMode ? '#EDEDED' : '#333333',
    cardShadow: darkMode ? 'transparent' : '#000',
    border: darkMode ? '#2A2A2A' : '#F0F0F0',
    primary: '#4F46E5',
    subtext: darkMode ? '#9CA3AF' : '#6B7280',
  };

  // Main fetch function
  const fetchStatus = useCallback(async (q: string, m?: number, y?: number) => {
     try {
       setLoading(true);
       setError(null);
       const base = getBaseUrl();
       const queryParam = q?.trim() || '';

       // Param construction
       const params = new URLSearchParams();
       if (queryParam) params.append('search', queryParam);
       if (m) params.append('month', String(m));
       if (y) params.append('year', String(y));
       params.append('_t', String(Date.now()));

       const url = `${base}/payment-installments/latest?${params.toString()}`;
       const latest = await apiFetchJson(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });

       if (latest.res.ok && Array.isArray(latest.json?.data)) {
         const rows: LatestInstallmentRow[] = latest.json.data;
         const mapped: Item[] = rows
           .map((r) => {
             const hn = String(r.house_number || '').trim();
             const st = r.status;
             if (!hn) return null;
             // เธ–้ามี month/year เธ—เธตเนเน€ลือก Status เธเธงเธฃเธเธฐเธชเธฐเธ—เนเธญเธเธ•เธฒเธกเธเธงเธ”เธ—เธตเนเนเธ”้มา
             // ซึ่ง backend เธเธฃเธญเธเธกเธฒเนเธซเนเนเธฅเนเธงเธงเนเธฒเธเธทเธญเธเธงเธ”เธ—ี่ cover เน€เธ”ือนนั้น
             // เธ”ังนั้น status เธเธญเธเธเธงเธ”เธเธฑเนเธเธเนเธเธทเธญเธชเธ–เธฒเธเธฐเธเธญเธเน€เธ”ือนนั้น
             return {
               houseNumber: hn,
               status: st === 'paid' || st === 'pending' || st === 'overdue' || st === 'waiting_approval' ? st : 'pending',
             } as Item;
           })
           .filter(Boolean) as Item[];
         setItems(mapped);
         return;
       }

       // Fallback logic removed for clarity as per backend changes
       setItems([]);
     } catch (e: any) {
       setError((e as any)?.message || t('payLoadFailed'));
     } finally {
       setLoading(false);
     }
   }, [t]);

   // Debounced fetch for search text
   const debouncedFetch = useMemo(
      () => debounce((q: string, m: number, y: number) => {
          fetchStatus(q, m, y);
      }, 500),
      [fetchStatus]
   );

   // Effect: Trigger fetch when search or filters change
   useEffect(() => {
      debouncedFetch(searchText, selectedMonth, selectedYear);
      return () => debouncedFetch.cancel();
   }, [searchText, selectedMonth, selectedYear, debouncedFetch]);

  const visibleItems = useMemo(() => {
    let list = items;
    if (statusFilter) list = list.filter(it => it.status === statusFilter);
    return list;
  }, [items, statusFilter]);

  const onClear = () => {
    setSearchText('');
  };

  const handleMonthChange = (delta: number) => {
    let newM = selectedMonth + delta;
    let newY = selectedYear;
    if (newM > 12) { newM = 1; newY++; }
    if (newM < 1) { newM = 12; newY--; }
    setSelectedMonth(newM);
    setSelectedYear(newY);
  };

  const setToday = () => {
      const d = new Date();
      setSelectedMonth(d.getMonth() + 1);
      setSelectedYear(d.getFullYear());
  };

  const displayYear = (y: number) => y + 543;

  const openMonthYearPicker = () => {
    setPickerMonth(selectedMonth);
    setPickerYear(selectedYear);
    setYearPickerOpen(false);
    setPickerVisible(true);
  };

  const applyPicker = () => {
    setSelectedMonth(pickerMonth);
    setSelectedYear(pickerYear);
    setYearPickerOpen(false);
    setPickerVisible(false);
  };

  const setPickerToToday = () => {
    const d = new Date();
    setPickerMonth(d.getMonth() + 1);
    setPickerYear(d.getFullYear());
  };

  const openYearPickerPopup = () => {
    setYearPageStart(pickerYear - 4);
    setPickerVisible(false);
    setYearPickerOpen(true);
  };

  const closeYearPickerBackToMonth = () => {
    setYearPickerOpen(false);
    setPickerVisible(true);
  };

  const yearOptions = useMemo(() => {
    return Array.from({ length: 9 }, (_, i) => yearPageStart + i);
  }, [yearPageStart]);

  const renderLegend = () => (
    <View style={styles.legendRow}>
      {(['paid', 'waiting_approval', 'pending', 'overdue'] as Status[]).map((s) => {
        const active = statusFilter === s;
        return (
          <TouchableOpacity
            key={s}
            onPress={() => setStatusFilter(prev => (prev === s ? null : s))}
            style={[styles.legendItem, active && styles.legendItemActive]}
          >
            <View style={[styles.legendDot, { backgroundColor: statusColor[s] }]} />
            <Text style={[styles.legendText, active ? styles.legendTextActive : { color: colors.text }]}>
              {t(statusLabelKeys[s])} ({counts[s]})
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const onRefreshPull = useCallback(async () => {
    setRefreshing(true);
    await fetchStatus(searchText, selectedMonth, selectedYear);
    setRefreshing(false);
  }, [fetchStatus, searchText, selectedMonth, selectedYear]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}> 
      {/* Search & Filters */}
      <View style={styles.filtersContainer}>
        {/* Row: Search + Month nav + Today btn */}
        <View style={styles.searchRow}>
          <View style={styles.inputWrap}>
            <Ionicons name="search" size={18} color={colors.subtext} style={styles.searchIcon} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder={t('paySearchHouse')}
              placeholderTextColor={colors.subtext}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              keyboardType="number-pad"
              inputMode="numeric"
              returnKeyType="search"
            />
            {searchText.length > 0 && (
              <TouchableOpacity accessibilityLabel="clear search" onPress={onClear} style={styles.clearBtn}>
                <Ionicons name="close-circle" size={18} color={colors.subtext} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Row: Month nav + Today btn */}
        <View style={styles.monthRow}>
          <TouchableOpacity onPress={() => handleMonthChange(-1)} style={styles.monthNavBtn}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity onPress={openMonthYearPicker} style={styles.monthLabelBtn} activeOpacity={0.85}>
            <Text style={[styles.monthText, { color: colors.text }]}>
              {t(MONTH_KEYS[selectedMonth - 1])} {displayYear(selectedYear)}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => handleMonthChange(1)} style={styles.monthNavBtn}>
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={setToday} style={[styles.todayBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.todayBtnText}>{t('payCurrentMonth')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={pickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setYearPickerOpen(false);
          setPickerVisible(false);
        }}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => {
            setYearPickerOpen(false);
            setPickerVisible(false);
          }}
        />
        <View style={styles.pickerWrap} pointerEvents="box-none">
          <View style={[styles.pickerCard, { backgroundColor: colors.bg, borderColor: colors.border }]}> 
            <View style={styles.pickerHeader}>
              <Text style={[styles.pickerTitle, { color: colors.text }]}>
                {t('paySelectMonthYear')}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setYearPickerOpen(false);
                  setPickerVisible(false);
                }}
                style={styles.pickerCloseBtn}
              >
                <Ionicons name="close" size={18} color={colors.subtext} />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerYearRow}>
              <TouchableOpacity
                style={[styles.pickerYearSelectBtn, { borderColor: colors.border }]}
                onPress={openYearPickerPopup}
                activeOpacity={0.85}
              >
                <Text style={[styles.pickerYearText, { color: colors.text }]}>{displayYear(pickerYear)}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.pickerMonthsGrid}>
              {MONTH_KEYS.map((k, idx) => {
                const m = idx + 1;
                const active = pickerMonth === m;
                return (
                  <TouchableOpacity
                    key={k}
                    onPress={() => setPickerMonth(m)}
                    style={[
                      styles.pickerMonthChip,
                      active ? styles.pickerMonthChipActive : styles.pickerMonthChipInactive,
                      active && { backgroundColor: colors.primary, borderColor: colors.primary },
                      !active && { borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.pickerMonthChipText, active ? styles.whiteText : { color: colors.text }]}> 
                      {t(k)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.pickerActionsRow}>
              <TouchableOpacity onPress={setPickerToToday} style={[styles.pickerActionBtn, styles.pickerActionBtnGhost, { borderColor: colors.border }]}> 
                <Text style={[styles.pickerActionText, { color: colors.text }]}>{t('payCurrentMonth')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={applyPicker} style={[styles.pickerActionBtn, styles.pickerActionBtnPrimary, { backgroundColor: colors.primary, borderColor: colors.primary }]}> 
                <Text style={[styles.pickerActionText, styles.whiteText]}>{t('payApply')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={yearPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={closeYearPickerBackToMonth}
      >
        <Pressable style={styles.yearModalBackdrop} onPress={closeYearPickerBackToMonth} />
        <View style={styles.yearModalWrap} pointerEvents="box-none">
          <View style={styles.yearModalCard}> 
            <View style={styles.yearModalHeader}>
              <Text style={styles.yearModalTitle}>{t('paySelectYear')}</Text>
              <TouchableOpacity onPress={closeYearPickerBackToMonth} style={styles.pickerCloseBtn}>
                <Ionicons name="close" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerYearsWrap}>
              {yearOptions.map((y) => {
                const active = y === pickerYear;
                return (
                  <TouchableOpacity
                    key={String(y)}
                    onPress={() => {
                      setPickerYear(y);
                      setYearPickerOpen(false);
                      setPickerVisible(true);
                    }}
                    style={[
                      styles.pickerYearChip,
                      active ? styles.pickerYearChipActive : styles.pickerYearChipInactive,
                    ]}
                  >
                    <Text style={[styles.pickerYearChipText, active ? styles.pickerYearChipTextActive : styles.pickerYearChipTextInactive]}> 
                      {displayYear(y)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.yearPagerRow}>
              <TouchableOpacity
                style={[styles.yearPagerBtn, { borderColor: colors.border }]}
                onPress={() => setYearPageStart(s => s - 9)}
                activeOpacity={0.85}
              >
                <Ionicons name="chevron-back" size={16} color={colors.text} />
                <Text style={[styles.yearPagerText, { color: colors.text }]}>{t('payPrevPage')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.yearPagerBtn, { borderColor: colors.border }]}
                onPress={() => setYearPageStart(s => s + 9)}
                activeOpacity={0.85}
              >
                <Text style={[styles.yearPagerText, { color: colors.text }]}>{t('payNextPage')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {renderLegend()}
      
      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t('payError')}: {error}</Text>
        </View>
      ) : null}

      <FlatList
        data={visibleItems}
        keyExtractor={(it, idx) => `${it.houseNumber}-${idx}`}
        numColumns={3}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefreshPull} />
        }
        renderItem={({ item }) => (
          <View style={[styles.cellWrap]}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                onSelectHouse?.(item.houseNumber);
              }}
              style={[
                styles.cell,
                { backgroundColor: statusColor[item.status], shadowColor: colors.cardShadow }
              ]}
            >
              <Text style={[styles.cellTitle, { color: statusTextColor[item.status] }]}>{t('payHouseNumber')}</Text>
              <Text style={[styles.cellValue, { color: statusTextColor[item.status] }]}>{item.houseNumber}</Text>
            </TouchableOpacity>
          </View>
        )}
      />
      {(!loading && visibleItems.length === 0) && (
        <View style={styles.emptyContainer}>
          <Text style={{ color: colors.text }}>{t('payHouseNotFoundSearch')}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filtersContainer: {
    marginBottom: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: 4,
    marginBottom: 8,
    gap: 6,
  },
  searchRow: {
    marginBottom: 8,
  },
  inputWrap: {
    position: 'relative',
  },
  searchIcon: {
    position: 'absolute', 
    left: 12, 
    top: 12, 
    zIndex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    paddingRight: 32,
    paddingLeft: 38,
  },
  clearBtn: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 32,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthNavBtn: {
    padding: 8,
  },
  monthText: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  monthLabelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  todayBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginLeft: 4,
  },
  todayBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  legendItemActive: { backgroundColor: '#EEF7EE', borderColor: '#2E7D32' },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 6,
  },
  legendText: {
    fontSize: 13,
    fontWeight: '600',
  },
  legendTextActive: { color: '#2E7D32', fontWeight: '800' },
  errorContainer: {
    paddingVertical: 10,
  },
  errorText: {
    color: '#C62828',
  },
  row: {
    justifyContent: 'space-between',
  },
  listContent: {
    paddingBottom: 24,
  },
  cellWrap: {
    flex: 1,
    padding: 6,
  },
  cell: {
    height: 90,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cellTitle: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.8,
    marginBottom: 4,
  },
  cellValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  yearModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 24, 39, 0.2)',
  },
  yearModalWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  yearModalCard: {
    width: '100%',
    maxWidth: 390,
    borderRadius: 18,
    borderWidth: 0,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#111827',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  yearModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  yearModalTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1F2937',
  },
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  pickerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  pickerCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  pickerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  pickerCloseBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pickerYearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  pickerYearSelectBtn: {
    minHeight: 34,
    minWidth: 112,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pickerYearNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerYearText: {
    fontSize: 18,
    fontWeight: '800',
    minWidth: 92,
    textAlign: 'center',
  },
  pickerYearsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 6,
    justifyContent: 'space-between',
  },
  pickerYearChip: {
    width: '31%',
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 0,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerYearChipActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  pickerYearChipInactive: {
    backgroundColor: '#F4F5F7',
    borderColor: '#E5E7EB',
  },
  pickerYearChipText: {
    fontSize: 15,
    fontWeight: '700',
  },
  pickerYearChipTextActive: {
    color: '#FFFFFF',
  },
  pickerYearChipTextInactive: {
    color: '#374151',
  },
  yearPagerRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  yearPagerBtn: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F9FAFB',
  },
  yearPagerText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pickerMonthsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  pickerMonthChip: {
    width: '31.2%',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 38,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerMonthChipActive: {
    borderColor: '#4F46E5',
  },
  pickerMonthChipInactive: {
    backgroundColor: '#FFFFFF',
  },
  pickerMonthChipText: {
    fontSize: 14,
    fontWeight: '700',
  },
  pickerActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  pickerActionBtn: {
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pickerActionBtnGhost: {
    backgroundColor: '#F5F6F8',
  },
  pickerActionBtnPrimary: {
    minWidth: 74,
    alignItems: 'center',
  },
  pickerActionText: {
    fontSize: 15,
    fontWeight: '700',
  },
  whiteText: {
    color: '#FFFFFF',
  },
});

export default PaymentStatus;


