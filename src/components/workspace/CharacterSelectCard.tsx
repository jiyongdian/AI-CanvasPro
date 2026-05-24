import * as React from 'react';
import { memo } from 'react';
import { Card, Checkbox } from 'antd';
import { LazyImage } from '../common';
import { Character } from '../../types';
import styles from './CharacterSelectCard.module.css';

interface CharacterSelectCardProps {
  character: Character;
  isSelected: boolean;
  onToggle: (characterId: string) => void;
}

const CharacterSelectCard: React.FC<CharacterSelectCardProps> = memo(({
  character,
  isSelected,
  onToggle
}) => {
  const handleClick = React.useCallback(() => {
    onToggle(character.id);
  }, [character.id, onToggle]);

  return (
    <div 
      className={`${styles.card} ${isSelected ? styles.selected : ''}`}
      onClick={handleClick}
    >
      <div className={styles.avatar}>
        <LazyImage 
          src={character.referenceImage} 
          alt={character.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {isSelected && (
          <div className={styles.checkMark}>
            <Checkbox checked={true} />
          </div>
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{character.name}</div>
        {character.description && (
          <div className={styles.description}>
            {character.description.slice(0, 20)}
          </div>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.character.id === nextProps.character.id &&
    prevProps.character.referenceImage === nextProps.character.referenceImage &&
    prevProps.character.name === nextProps.character.name &&
    prevProps.isSelected === nextProps.isSelected
  );
});

CharacterSelectCard.displayName = 'CharacterSelectCard';

export default CharacterSelectCard;
